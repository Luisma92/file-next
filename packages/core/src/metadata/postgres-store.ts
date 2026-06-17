/**
 * `createPostgresStore` — a Drizzle + node-postgres-backed
 * `MetadataStore` adapter with structural tenant isolation via
 * Row-Level Security (RLS).
 *
 * The structural piece: every transaction opens with
 * `SET LOCAL app.current_tenant = $1`. The RLS policy
 * (`current_setting('app.current_tenant', true) = tenant_id`)
 * is then enforced for every read AND write — so even a buggy
 * `SELECT * FROM file_nodes` (no WHERE clause) returns zero rows
 * unless the GUC is set in the same transaction.
 *
 * `SET LOCAL` is transaction-scoped (reverts on COMMIT/ROLLBACK)
 * AND session-safe (the GUC doesn't leak to other transactions
 * on the same connection — the pool is safe to share).
 *
 * The adapter ALSO filters by tenantId in app code (defense in
 * depth, matches the SQLite adapter). The two layers together
 * give us "a forgotten WHERE clause is caught by the DB" +
 * "the DB's tenant scoping is verified by the adapter's WHERE".
 *
 * Accepts either a `pg.Pool` (recommended) or a `pg.Client`.
 * With a Pool, every method acquires a connection from the pool
 * for the duration of the transaction; the connection is
 * returned when the transaction commits/rolls back.
 */
import { and, eq, isNull, like, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type Client } from "pg";
import { err, ok, type Result } from "@/types/result";
import { FileSystemError } from "@/errors";
import { asTenantId, asUserId } from "@/types/branded";
import { fileNodes, FILE_NODES_DDL } from "./postgres-schema";
import type {
  CreateNodeInput,
  DeleteNodeInput,
  FileNode,
  GetNodeInput,
  GetPathInput,
  GetPathOutput,
  ListChildrenInput,
  ListChildrenOutput,
  MetadataStore,
  MoveNodeInput,
  ReconcileResult,
  SearchInput,
  UpdateMetadataInput,
} from "./store";

type DbClient = NodePgDatabase;
type PoolOrClient = Pool | Client | DbClient;

/**
 * Accept a `pg.Pool`, `pg.Client`, or an already-constructed Drizzle
 * database. The Drizzle form is most useful for tests that want
 * to inject a mocked Drizzle instance; production code passes a
 * Pool (recommended) or Client.
 */
export const createPostgresStore = (
  pg: PoolOrClient,
): MetadataStore => {
  // If we got a raw Pool/Client, wrap it in Drizzle. If we got a
  // Drizzle db already, use it directly (avoids double-wrapping).
  // We detect the Drizzle form by checking for the `driver` field
  // (Pool/Client don't have one; Drizzle's wrapper does).
  const isDrizzle = (pg as { driver?: unknown })?.driver !== undefined;
  const db: DbClient = isDrizzle ? (pg as DbClient) : drizzle(pg as Pool | Client);

  // Apply the DDL on first use. We need a raw Pool/Client to
  // exec() the multi-statement DDL, so if we got a pre-wrapped
  // Drizzle db we extract the underlying driver. For the common
  // case (Pool/Client passed in), we use the pg driver directly.
  const rawPg = (pg as Pool | Client).query
    ? (pg as Pool | Client)
    : ((pg as { driver?: { query?: (q: string) => Promise<unknown> } }).driver as unknown as Pool | Client) ??
      (pg as unknown as Pool | Client);
  void db;
  void rawPg;

  // The DDL application is best-effort; if it fails (e.g. the
  // user has a custom schema) the actual queries will surface
  // the real error. We don't want a missing DDL to crash
  // createPostgresStore itself.
  void (async () => {
    try {
      const ddl = FILE_NODES_DDL.queryChunks
        .map((c2) => (typeof c2 === "string" ? c2 : ""))
        .join("");
      // Pool has connect() that returns a PoolClient (with .release).
      // Client has query() directly (no .release). We branch on the
      // shape to handle both.
      if ("connect" in rawPg && typeof (rawPg as Pool).connect === "function") {
        const c: PoolClient = await (rawPg as Pool).connect();
        try {
          await c.query(ddl);
        } finally {
          c.release();
        }
      } else if ("query" in rawPg && typeof (rawPg as Client).query === "function") {
        await (rawPg as Client).query(ddl);
      }
    } catch {
      // Best-effort: surface the real error on the first query.
    }
  })();

  // Helper: run an async function inside a transaction with the
  // per-tx `app.current_tenant` GUC set. The raw pg Pool/Client
  // is used for transaction control (BEGIN/COMMIT/ROLLBACK +
  // SET LOCAL). The Drizzle db is used for the actual queries.
  const withTenant = async <T>(
    tenantId: string,
    fn: (txDb: DbClient) => Promise<T>,
  ): Promise<T> => {
    const client: PoolClient = await (rawPg as Pool).connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL app.current_tenant = $1", [tenantId]);
      // Build a tx-scoped Drizzle db bound to THIS client.
      const txDb = drizzle(client);
      const result = await fn(txDb);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
      throw e;
    } finally {
      client.release();
    }
  };

  // Map a row to the FileNode shape.
  const rowToNode = (r: typeof fileNodes.$inferSelect): FileNode => ({
    id: r.id,
    tenantId: asTenantId(r.tenantId),
    parentId: r.parentId,
    name: r.name,
    path: r.path,
    kind: r.kind,
    size: r.size,
    mimeType: r.mimeType,
    s3Key: r.s3Key,
    ownerId: asUserId(r.ownerId),
    metadata: (r.metadata ?? {}) as Record<string, string>,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
    deletedAt: r.deletedAt === null ? null : new Date(r.deletedAt),
  });

  const nowMs = (): number => Date.now();

  const makeId = (): string => {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return `pg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  };

  // Internal error wrapper.
  const wrapErr = (e: unknown, msg: string): Result<never, FileSystemError> =>
    err(
      new FileSystemError({
        code: "InternalError",
        message: `${msg}: ${e instanceof Error ? e.message : String(e)}`,
        retryable: true,
      }),
    );

  return {
    async createNode(input: CreateNodeInput): Promise<Result<FileNode, FileSystemError>> {
      return withTenant(input.tenantId, async (txDb) => {
        // Dup check (RACE: a unique index would also catch this).
        const whereParts = [
          eq(fileNodes.tenantId, input.tenantId),
          input.parentId === null
            ? isNull(fileNodes.parentId)
            : eq(fileNodes.parentId, input.parentId),
          eq(fileNodes.name, input.name),
          isNull(fileNodes.deletedAt),
        ];
        const existing = await txDb.select().from(fileNodes).where(and(...whereParts)).limit(1);
        if (existing.length > 0) {
          return err(
            new FileSystemError({
              code: "Conflict",
              message: `A node named '${input.name}' already exists in this folder`,
              retryable: false,
            }),
          );
        }

        const id = makeId();
        const ts = nowMs();
        // Compute the materialized path.
        let path = `/${input.name}`;
        if (input.parentId !== null) {
          const parent = await txDb
            .select({ path: fileNodes.path })
            .from(fileNodes)
            .where(eq(fileNodes.id, input.parentId))
            .limit(1);
          if (parent[0]) {
            path = `${parent[0].path}/${input.name}`;
          }
        }

        try {
          await txDb.insert(fileNodes).values({
            id,
            tenantId: input.tenantId,
            parentId: input.parentId,
            name: input.name,
            path,
            kind: input.kind,
            size: input.kind === "folder" ? 0 : input.size,
            mimeType: input.kind === "folder" ? "" : input.mimeType,
            s3Key: input.kind === "folder" ? "" : input.s3Key,
            ownerId: input.ownerId,
            metadata: input.metadata ?? {},
            createdAt: ts,
            updatedAt: ts,
            deletedAt: null,
          });
        } catch (e) {
          return wrapErr(e, "Failed to create node");
        }

        const created = await txDb.select().from(fileNodes).where(eq(fileNodes.id, id)).limit(1);
        if (!created[0]) {
          return err(
            new FileSystemError({
              code: "InternalError",
              message: "Failed to read back created node",
              retryable: true,
            }),
          );
        }
        return ok(rowToNode(created[0]));
      });
    },

    async getNode(input: GetNodeInput): Promise<Result<FileNode | null, FileSystemError>> {
      return withTenant(input.tenantId, async (txDb) => {
        const row = await txDb
          .select()
          .from(fileNodes)
          .where(
            and(
              eq(fileNodes.id, input.id),
              eq(fileNodes.tenantId, input.tenantId),
              isNull(fileNodes.deletedAt),
            ),
          )
          .limit(1);
        return ok(row[0] ? rowToNode(row[0]) : null);
      });
    },

    async listChildren(input: ListChildrenInput): Promise<Result<ListChildrenOutput, FileSystemError>> {
      return withTenant(input.tenantId, async (txDb) => {
        const whereParts = [
          eq(fileNodes.tenantId, input.tenantId),
          input.parentId === null
            ? isNull(fileNodes.parentId)
            : eq(fileNodes.parentId, input.parentId),
          isNull(fileNodes.deletedAt),
        ];
        const rows = await txDb
          .select()
          .from(fileNodes)
          .where(and(...whereParts))
          .orderBy(fileNodes.name);
        const items = rows.map(rowToNode);
        const limit = input.limit ?? items.length;
        const page = items.slice(0, limit);
        return ok({
          items: page,
          nextCursor: items.length > limit ? page[page.length - 1]?.id : undefined,
        });
      });
    },

    async moveNode(input: MoveNodeInput): Promise<Result<FileNode, FileSystemError>> {
      return withTenant(input.tenantId, async (txDb) => {
        const target = await txDb
          .select()
          .from(fileNodes)
          .where(
            and(
              eq(fileNodes.id, input.id),
              eq(fileNodes.tenantId, input.tenantId),
              isNull(fileNodes.deletedAt),
            ),
          )
          .limit(1);
        if (!target[0]) {
          return err(
            new FileSystemError({
              code: "NotFound",
              message: `Node ${input.id} not found`,
              retryable: false,
            }),
          );
        }
        const t = target[0];

        // Cycle check
        let cursor: string | null = input.newParentId;
        while (cursor !== null) {
          if (cursor === t.id) {
            return err(
              new FileSystemError({
                code: "Conflict",
                message: "Cannot move a folder into its own descendant",
                retryable: false,
              }),
            );
          }
          const parent = await txDb
            .select({ parentId: fileNodes.parentId })
            .from(fileNodes)
            .where(eq(fileNodes.id, cursor))
            .limit(1);
          cursor = parent[0]?.parentId ?? null;
        }

        const newName = input.newName ?? t.name;
        const collision = await txDb
          .select({ id: fileNodes.id })
          .from(fileNodes)
          .where(
            and(
              eq(fileNodes.tenantId, input.tenantId),
              input.newParentId === null
                ? isNull(fileNodes.parentId)
                : eq(fileNodes.parentId, input.newParentId),
              eq(fileNodes.name, newName),
              isNull(fileNodes.deletedAt),
            ),
          );
        if (collision.find((c) => c.id !== t.id)) {
          return err(
            new FileSystemError({
              code: "Conflict",
              message: `A node named '${newName}' already exists in the destination folder`,
              retryable: false,
            }),
          );
        }

        let newPath = `/${newName}`;
        if (input.newParentId !== null) {
          const newParent = await txDb
            .select({ path: fileNodes.path })
            .from(fileNodes)
            .where(eq(fileNodes.id, input.newParentId))
            .limit(1);
          if (newParent[0]) {
            newPath = `${newParent[0].path}/${newName}`;
          }
        }

        const oldPath = t.path;
        const ts = nowMs();

        try {
          await txDb
            .update(fileNodes)
            .set({
              parentId: input.newParentId,
              name: newName,
              path: newPath,
              updatedAt: ts,
            })
            .where(eq(fileNodes.id, t.id));
          // Cascade to descendants
          await txDb
            .update(fileNodes)
            .set({
              path: sql`${newPath} || substring(${fileNodes.path} from ${oldPath.length + 1})`,
              updatedAt: ts,
            })
            .where(
              and(
                eq(fileNodes.tenantId, t.tenantId),
                like(fileNodes.path, `${oldPath}/%`),
              ),
            );
        } catch (e) {
          return wrapErr(e, "Failed to move node");
        }

        const updated = await txDb.select().from(fileNodes).where(eq(fileNodes.id, t.id)).limit(1);
        if (!updated[0]) {
          return err(
            new FileSystemError({
              code: "InternalError",
              message: "Failed to read back moved node",
              retryable: true,
            }),
          );
        }
        return ok(rowToNode(updated[0]));
      });
    },

    async deleteNode(input: DeleteNodeInput): Promise<Result<void, FileSystemError>> {
      return withTenant(input.tenantId, async (txDb) => {
        const target = await txDb
          .select()
          .from(fileNodes)
          .where(
            and(
              eq(fileNodes.id, input.id),
              eq(fileNodes.tenantId, input.tenantId),
              isNull(fileNodes.deletedAt),
            ),
          )
          .limit(1);
        if (!target[0]) {
          return err(
            new FileSystemError({
              code: "NotFound",
              message: `Node ${input.id} not found`,
              retryable: false,
            }),
          );
        }
        const t = target[0];

        if (!input.recursive && t.kind === "folder") {
          const live = await txDb
            .select({ id: fileNodes.id })
            .from(fileNodes)
            .where(
              and(
                eq(fileNodes.tenantId, input.tenantId),
                eq(fileNodes.parentId, t.id),
                isNull(fileNodes.deletedAt),
              ),
            )
            .limit(1);
          if (live.length > 0) {
            return err(
              new FileSystemError({
                code: "Conflict",
                message: `Folder '${t.name}' is not empty; pass recursive: true to delete the subtree`,
                retryable: false,
              }),
            );
          }
        }

        const ts = nowMs();
        try {
          if (input.recursive || t.kind === "file") {
            await txDb
              .update(fileNodes)
              .set({ deletedAt: ts, updatedAt: ts })
              .where(
                and(
                  eq(fileNodes.tenantId, input.tenantId),
                  sql`(${fileNodes.path} = ${t.path} OR ${fileNodes.path} LIKE ${t.path + "/%"})`,
                ),
              );
          } else {
            await txDb
              .update(fileNodes)
              .set({ deletedAt: ts, updatedAt: ts })
              .where(eq(fileNodes.id, t.id));
          }
        } catch (e) {
          return wrapErr(e, "Failed to delete node");
        }

        return ok(undefined);
      });
    },

    async updateMetadata(input: UpdateMetadataInput): Promise<Result<FileNode, FileSystemError>> {
      return withTenant(input.tenantId, async (txDb) => {
        const target = await txDb
          .select()
          .from(fileNodes)
          .where(
            and(
              eq(fileNodes.id, input.id),
              eq(fileNodes.tenantId, input.tenantId),
              isNull(fileNodes.deletedAt),
            ),
          )
          .limit(1);
        if (!target[0]) {
          return err(
            new FileSystemError({
              code: "NotFound",
              message: `Node ${input.id} not found`,
              retryable: false,
            }),
          );
        }
        const current = (target[0].metadata ?? {}) as Record<string, string>;
        const next = input.replace
          ? { ...input.metadata }
          : { ...current, ...input.metadata };

        await txDb
          .update(fileNodes)
          .set({ metadata: next, updatedAt: nowMs() })
          .where(eq(fileNodes.id, input.id));

        const updated = await txDb.select().from(fileNodes).where(eq(fileNodes.id, input.id)).limit(1);
        if (!updated[0]) {
          return err(
            new FileSystemError({
              code: "InternalError",
              message: "Failed to read back updated node",
              retryable: true,
            }),
          );
        }
        return ok(rowToNode(updated[0]));
      });
    },

    async search(input: SearchInput): Promise<Result<ListChildrenOutput, FileSystemError>> {
      return withTenant(input.tenantId, async (txDb) => {
        const pattern = `%${input.query.toLowerCase()}%`;
        const whereParts = [
          eq(fileNodes.tenantId, input.tenantId),
          isNull(fileNodes.deletedAt),
          sql`lower(${fileNodes.name}) LIKE ${pattern}`,
        ];
        if (input.parentId !== undefined) {
          whereParts.push(eq(fileNodes.parentId, input.parentId));
        }
        const rows = await txDb
          .select()
          .from(fileNodes)
          .where(and(...whereParts))
          .orderBy(fileNodes.name);
        const items = rows.map(rowToNode);
        const limit = input.limit ?? items.length;
        const page = items.slice(0, limit);
        return ok({
          items: page,
          nextCursor: items.length > limit ? page[page.length - 1]?.id : undefined,
        });
      });
    },

    async getPath(input: GetPathInput): Promise<Result<GetPathOutput, FileSystemError>> {
      return withTenant(input.tenantId, async (txDb) => {
        const target = await txDb
          .select()
          .from(fileNodes)
          .where(
            and(
              eq(fileNodes.id, input.id),
              eq(fileNodes.tenantId, input.tenantId),
              isNull(fileNodes.deletedAt),
            ),
          )
          .limit(1);
        if (!target[0]) {
          return err(
            new FileSystemError({
              code: "NotFound",
              message: `Node ${input.id} not found`,
              retryable: false,
            }),
          );
        }
        // Walk the parent chain. Postgres supports recursive CTEs
        // for arbitrarily deep paths, but the depth is bounded in
        // practice (< 20). v0.2 can add a recursive CTE.
        const segments: FileNode[] = [];
        let cursor: FileNode | undefined = rowToNode(target[0]);
        while (cursor) {
          segments.unshift(cursor);
          if (cursor.parentId === null) break;
          const parent = await txDb
            .select()
            .from(fileNodes)
            .where(eq(fileNodes.id, cursor.parentId))
            .limit(1);
          if (!parent[0]) break;
          cursor = rowToNode(parent[0]);
        }
        return ok({ segments });
      });
    },

    async reconcile(): Promise<Result<ReconcileResult, FileSystemError>> {
      return withTenant("__system__", async (txDb) => {
        // v0.1: no-op. The full reconcile walks the S3 bucket via
        // the storage adapter and compares against the store.
        // v0.2 will plumb the bucket walk through here.
        const all = await txDb
          .select({ id: fileNodes.id })
          .from(fileNodes)
          .where(isNull(fileNodes.deletedAt));
        return ok({ orphansInStore: [], orphansInS3: [], scanned: all.length });
      });
    },
  };
};
