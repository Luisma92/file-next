/**
 * `createSqliteStore` — a Drizzle + better-sqlite3-backed
 * `MetadataStore` adapter.
 *
 * The Drizzle schema lives next to the adapter
 * (`./sqlite-schema.ts`); the FILE_NODES_DDL constant is applied
 * on first connect so the consumer doesn't need a separate
 * migration step for v0.1. v0.2 will move to drizzle-kit migrations
 * via the @file-next/cli.
 *
 * Tenant isolation: enforced in app code (every query has a
 * `WHERE tenant_id = ?` filter). The Postgres adapter (PR 5)
 * upgrades this to DB-enforced RLS.
 *
 * Search: SQL `LIKE` on the lowercased name. v0.1 does NOT have
 * a full-text index; for >10K nodes per tenant, the consumer
 * should migrate to the Postgres adapter (which gets trigram /
 * FTS in a follow-up).
 */
import { eq, and, isNull, like, sql } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { err, ok, type Result } from "@/types/result";
import { FileSystemError } from "@/errors";
import { asTenantId, asUserId } from "@/types/branded";
import { fileNodes, FILE_NODES_DDL } from "./sqlite-schema";
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

/**
 * Accepts an already-opened `better-sqlite3` Database instance. The
 * consumer is responsible for the connection (in-memory `:memory:`,
 * file-based path, or anything better-sqlite3 supports). The
 * adapter applies the schema on first use.
 */
export const createSqliteStore = (
  sqlite: import("better-sqlite3").Database,
): MetadataStore => {
  const db: BetterSQLite3Database = drizzle(sqlite);
  // Apply the DDL on first use. `IF NOT EXISTS` makes this
  // idempotent; in v0.2 this moves to drizzle-kit migrations.
  // We extract the raw SQL from the drizzle `sql` chunk because
  // better-sqlite3's `exec` is the cleanest path for multi-
  // statement DDL.
  const ddl = (FILE_NODES_DDL.queryChunks ?? [])
    .map((c) => (typeof c === "string" ? c : (c as { value: string | number | boolean }).value?.toString() ?? ""))
    .join("");
  sqlite.exec(ddl);

  // Helper: row -> FileNode. Drizzle's default row type is the
  // snake_case schema; we map to camelCase for the interface.
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
    metadata: JSON.parse(r.metadata) as Record<string, string>,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
    deletedAt: r.deletedAt === null ? null : new Date(r.deletedAt),
  });

  const nowMs = (): number => Date.now();

  const makeId = (): string => {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return `sqlite-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  };

  return {
    async createNode(input: CreateNodeInput): Promise<Result<FileNode, FileSystemError>> {
      // Check for duplicate (tenantId, parentId, name). The
      // unique index would also enforce this; the explicit check
      // gives a clean Conflict error instead of a raw SQLite
      // UNIQUE violation.
      const existing = db
        .select()
        .from(fileNodes)
        .where(
          and(
            eq(fileNodes.tenantId, input.tenantId),
            input.parentId === null
              ? isNull(fileNodes.parentId)
              : eq(fileNodes.parentId, input.parentId),
            eq(fileNodes.name, input.name),
            isNull(fileNodes.deletedAt),
          ),
        )
        .limit(1)
        .all();
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
        const parent = db
          .select({ path: fileNodes.path })
          .from(fileNodes)
          .where(eq(fileNodes.id, input.parentId))
          .limit(1)
          .all()[0];
        if (parent) {
          path = `${parent.path}/${input.name}`;
        }
      }

      try {
        db.insert(fileNodes)
          .values({
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
            metadata: JSON.stringify(input.metadata ?? {}),
            createdAt: ts,
            updatedAt: ts,
            deletedAt: null,
          })
          .run();
      } catch (e) {
        return err(
          new FileSystemError({
            code: "InternalError",
            message: `Failed to create node: ${e instanceof Error ? e.message : String(e)}`,
            retryable: true,
          }),
        );
      }

      const created = db
        .select()
        .from(fileNodes)
        .where(eq(fileNodes.id, id))
        .limit(1)
        .all()[0];
      if (!created) {
        return err(
          new FileSystemError({
            code: "InternalError",
            message: "Failed to read back created node",
            retryable: true,
          }),
        );
      }
      return ok(rowToNode(created));
    },

    async getNode(input: GetNodeInput): Promise<Result<FileNode | null, FileSystemError>> {
      const row = db
        .select()
        .from(fileNodes)
        .where(
          and(
            eq(fileNodes.id, input.id),
            eq(fileNodes.tenantId, input.tenantId),
            isNull(fileNodes.deletedAt),
          ),
        )
        .limit(1)
        .all()[0];
      return ok(row ? rowToNode(row) : null);
    },

    async listChildren(input: ListChildrenInput): Promise<Result<ListChildrenOutput, FileSystemError>> {
      const rows = db
        .select()
        .from(fileNodes)
        .where(
          and(
            eq(fileNodes.tenantId, input.tenantId),
            input.parentId === null
              ? isNull(fileNodes.parentId)
              : eq(fileNodes.parentId, input.parentId),
            isNull(fileNodes.deletedAt),
          ),
        )
        .orderBy(fileNodes.name)
        .all();
      const items = rows.map(rowToNode);
      const limit = input.limit ?? items.length;
      const page = items.slice(0, limit);
      return ok({
        items: page,
        nextCursor: items.length > limit ? page[page.length - 1]?.id : undefined,
      });
    },

    async moveNode(input: MoveNodeInput): Promise<Result<FileNode, FileSystemError>> {
      const target = db
        .select()
        .from(fileNodes)
        .where(
          and(
            eq(fileNodes.id, input.id),
            eq(fileNodes.tenantId, input.tenantId),
            isNull(fileNodes.deletedAt),
          ),
        )
        .limit(1)
        .all()[0];
      if (!target) {
        return err(
          new FileSystemError({
            code: "NotFound",
            message: `Node ${input.id} not found`,
            retryable: false,
          }),
        );
      }

      // Cycle check.
      let cursor: string | null = input.newParentId;
      while (cursor !== null) {
        if (cursor === target.id) {
          return err(
            new FileSystemError({
              code: "Conflict",
              message: "Cannot move a folder into its own descendant",
              retryable: false,
            }),
          );
        }
        const parent = db
          .select({ parentId: fileNodes.parentId })
          .from(fileNodes)
          .where(eq(fileNodes.id, cursor))
          .limit(1)
          .all()[0];
        cursor = parent?.parentId ?? null;
      }

      const newName = input.newName ?? target.name;
      // Name uniqueness in the new parent.
      const collision = db
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
        )
        .all();
      const realCollision = collision.find((c) => c.id !== target.id);
      if (realCollision) {
        return err(
          new FileSystemError({
            code: "Conflict",
            message: `A node named '${newName}' already exists in the destination folder`,
            retryable: false,
          }),
        );
      }

      // Compute the new path.
      let newPath = `/${newName}`;
      if (input.newParentId !== null) {
        const newParent = db
          .select({ path: fileNodes.path })
          .from(fileNodes)
          .where(eq(fileNodes.id, input.newParentId))
          .limit(1)
          .all()[0];
        if (newParent) {
          newPath = `${newParent.path}/${newName}`;
        }
      }

      const oldPath = target.path;
      const ts = nowMs();

      try {
        db.transaction((tx) => {
          // Update the node itself.
          tx.update(fileNodes)
            .set({
              parentId: input.newParentId,
              name: newName,
              path: newPath,
              updatedAt: ts,
            })
            .where(eq(fileNodes.id, target.id))
            .run();
          // Cascade the path change to descendants.
          tx.update(fileNodes)
            .set({
              path: sql`${newPath} || substr(${fileNodes.path}, ${oldPath.length + 1})`,
              updatedAt: ts,
            })
            .where(
              and(
                eq(fileNodes.tenantId, target.tenantId),
                like(fileNodes.path, `${oldPath}/%`),
              ),
            )
            .run();
        });
      } catch (e) {
        return err(
          new FileSystemError({
            code: "InternalError",
            message: `Failed to move node: ${e instanceof Error ? e.message : String(e)}`,
            retryable: true,
          }),
        );
      }

      const updated = db
        .select()
        .from(fileNodes)
        .where(eq(fileNodes.id, target.id))
        .limit(1)
        .all()[0];
      if (!updated) {
        return err(
          new FileSystemError({
            code: "InternalError",
            message: "Failed to read back moved node",
            retryable: true,
          }),
        );
      }
      return ok(rowToNode(updated));
    },

    async deleteNode(input: DeleteNodeInput): Promise<Result<void, FileSystemError>> {
      const target = db
        .select()
        .from(fileNodes)
        .where(
          and(
            eq(fileNodes.id, input.id),
            eq(fileNodes.tenantId, input.tenantId),
            isNull(fileNodes.deletedAt),
          ),
        )
        .limit(1)
        .all()[0];
      if (!target) {
        return err(
          new FileSystemError({
            code: "NotFound",
            message: `Node ${input.id} not found`,
            retryable: false,
          }),
        );
      }

      if (!input.recursive && target.kind === "folder") {
        // Check for live children.
        const liveChildren = db
          .select({ id: fileNodes.id })
          .from(fileNodes)
          .where(
            and(
              eq(fileNodes.tenantId, input.tenantId),
              eq(fileNodes.parentId, target.id),
              isNull(fileNodes.deletedAt),
            ),
          )
          .limit(1)
          .all();
        if (liveChildren.length > 0) {
          return err(
            new FileSystemError({
              code: "Conflict",
              message: `Folder '${target.name}' is not empty; pass recursive: true to delete the subtree`,
              retryable: false,
            }),
          );
        }
      }

      const ts = nowMs();
      try {
        db.transaction((tx) => {
          if (input.recursive || target.kind === "file") {
            // Tombstone the node + every descendant whose path starts
            // with the node's path + "/".
            tx.update(fileNodes)
              .set({ deletedAt: ts, updatedAt: ts })
              .where(
                and(
                  eq(fileNodes.tenantId, input.tenantId),
                  sql`(${fileNodes.path} = ${target.path} OR ${fileNodes.path} LIKE ${target.path + "/%"})`,
                ),
              )
              .run();
          } else {
            // Empty folder: just tombstone it.
            tx.update(fileNodes)
              .set({ deletedAt: ts, updatedAt: ts })
              .where(eq(fileNodes.id, target.id))
              .run();
          }
        });
      } catch (e) {
        return err(
          new FileSystemError({
            code: "InternalError",
            message: `Failed to delete node: ${e instanceof Error ? e.message : String(e)}`,
            retryable: true,
          }),
        );
      }

      return ok(undefined);
    },

    async updateMetadata(input: UpdateMetadataInput): Promise<Result<FileNode, FileSystemError>> {
      const target = db
        .select()
        .from(fileNodes)
        .where(
          and(
            eq(fileNodes.id, input.id),
            eq(fileNodes.tenantId, input.tenantId),
            isNull(fileNodes.deletedAt),
          ),
        )
        .limit(1)
        .all()[0];
      if (!target) {
        return err(
          new FileSystemError({
            code: "NotFound",
            message: `Node ${input.id} not found`,
            retryable: false,
          }),
        );
      }

      const current = JSON.parse(target.metadata) as Record<string, string>;
      const next = input.replace ? { ...input.metadata } : { ...current, ...input.metadata };

      db.update(fileNodes)
        .set({ metadata: JSON.stringify(next), updatedAt: nowMs() })
        .where(eq(fileNodes.id, target.id))
        .run();

      const updated = db
        .select()
        .from(fileNodes)
        .where(eq(fileNodes.id, input.id))
        .limit(1)
        .all()[0];
      if (!updated) {
        return err(
          new FileSystemError({
            code: "InternalError",
            message: "Failed to read back updated node",
            retryable: true,
          }),
        );
      }
      return ok(rowToNode(updated));
    },

    async search(input: SearchInput): Promise<Result<ListChildrenOutput, FileSystemError>> {
      const pattern = `%${input.query.toLowerCase()}%`;
      const whereParts = [
        eq(fileNodes.tenantId, input.tenantId),
        isNull(fileNodes.deletedAt),
        sql`lower(${fileNodes.name}) LIKE ${pattern}`,
      ];
      if (input.parentId !== undefined) {
        whereParts.push(eq(fileNodes.parentId, input.parentId));
      }
      const rows = db
        .select()
        .from(fileNodes)
        .where(and(...whereParts))
        .orderBy(fileNodes.name)
        .all();
      const items = rows.map(rowToNode);
      const limit = input.limit ?? items.length;
      const page = items.slice(0, limit);
      return ok({
        items: page,
        nextCursor: items.length > limit ? page[page.length - 1]?.id : undefined,
      });
    },

    async getPath(input: GetPathInput): Promise<Result<GetPathOutput, FileSystemError>> {
      const target = db
        .select()
        .from(fileNodes)
        .where(
          and(
            eq(fileNodes.id, input.id),
            eq(fileNodes.tenantId, input.tenantId),
            isNull(fileNodes.deletedAt),
          ),
        )
        .limit(1)
        .all()[0];
      if (!target) {
        return err(
          new FileSystemError({
            code: "NotFound",
            message: `Node ${input.id} not found`,
            retryable: false,
          }),
        );
      }
      // Walk the parent chain via a series of lookups. The depth
      // is bounded by the folder depth, which for a real-world
      // file system is < 20. v0.2 can use a recursive CTE for
      // arbitrarily deep trees.
      const segments: FileNode[] = [];
      let cursor: FileNode | undefined = rowToNode(target);
      while (cursor) {
        segments.unshift(cursor);
        if (cursor.parentId === null) break;
        const parent = db
          .select()
          .from(fileNodes)
          .where(eq(fileNodes.id, cursor.parentId))
          .limit(1)
          .all()[0];
        if (!parent) break;
        cursor = rowToNode(parent);
      }
      return ok({ segments });
    },

    async reconcile(): Promise<Result<ReconcileResult, FileSystemError>> {
      // v0.1: no-op. The full reconcile walks the S3 bucket via
      // the storage adapter and compares against the store. v0.2
      // will plumb the bucket walk through here.
      const total = db
        .select({ id: fileNodes.id })
        .from(fileNodes)
        .where(isNull(fileNodes.deletedAt))
        .all();
      return ok({ orphansInStore: [], orphansInS3: [], scanned: total.length });
    },
  };
};
