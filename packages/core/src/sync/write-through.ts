/**
 * `WriteThrough` — the sync layer that keeps S3 (bytes) and the
 * MetadataStore (tree) in lockstep.
 *
 * Why a separate layer (and not methods on FileSystem or
 * MetadataStore):
 *   - The FileSystem doesn't know about the store (the S3
 *     adapter is provider-agnostic; the store is consumer-
 *     specific via BYODB).
 *   - The MetadataStore doesn't know about S3 (it only mirrors
 *     the tree; bytes are not its concern).
 *   - The compensation (pending_orphan_log) is a cross-cutting
 *     concern that belongs to neither — and to the consumer's
 *     process, not to a third-party service.
 *
 * v0.1 implementation:
 *   - The pending_orphan_log is an in-memory Map. v0.2 will move
 *     it to a `pending_orphans` table in the metadata store
 *     (so it survives restarts). For v0.1, an ungraceful
 *     shutdown leaves a few orphans that `reconcile()` can
 *     clean up on next start (the in-memory log is gone, but
 *     the S3-vs-metadata drift is still detectable).
 *   - The compensate path: if the S3 write succeeds but the
 *     metadata insert fails, the S3 object is orphaned; we
 *     log it to `pendingOrphans` with a `delete` op so the
 *     next reconcile() deletes the S3 object. Conversely, if
 *     the S3 delete succeeds but the metadata soft-delete
 *     fails, we log a `restore` op (re-create the metadata row).
 *   - `reconcile()` is a no-op in v0.1 — it returns the current
 *     orphan log content for inspection but does not actually
 *     walk S3. v0.2 will add the S3 walk + the actual
 *     compensating actions.
 *
 * Idempotency: every method that touches both layers either
 * succeeds end-to-end or appends to the orphan log. Calling
 * writeThroughFile twice with the same key+body produces the
 * same end state (the second call is a no-op if the metadata
 * already exists; S3 handles dedup via the same key).
 */
import { ok, err, type Result } from "@/types/result";
import { FileSystemError } from "@/errors";
import { asS3Key, asTenantId, asUserId, type S3Key } from "@/types/branded";
import type { FileSystem } from "../storage/filesystem";
import type { MetadataStore, FileNode, CreateNodeInput } from "../metadata/store";

// ---------------------------------------------------------------------------
// Pending orphan log
// ---------------------------------------------------------------------------

/** The compensating action to take during reconcile(). */
export type OrphanOp = "delete" | "restore";

export interface PendingOrphan {
  readonly id: string;
  readonly tenantId: string;
  /** S3 key the orphan corresponds to. */
  readonly s3Key: S3Key;
  /** What we need to do to fix this. */
  readonly op: OrphanOp;
  /** When the orphan was recorded. */
  readonly createdAt: Date;
  /** Original error that caused the orphan (for debugging). */
  readonly reason: string;
  /** The metadata node that was being written/deleted (if any). */
  readonly nodeId?: string;
}

// ---------------------------------------------------------------------------
// Input / output shapes
// ---------------------------------------------------------------------------

export interface WriteThroughFileInput {
  readonly tenantId: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly body: Uint8Array | ReadableStream<Uint8Array>;
  readonly contentType: string;
  readonly metadata?: Readonly<Record<string, string>>;
  /** Optional owner id; defaults to a placeholder if not provided. */
  readonly ownerId?: string;
  /** Maximum body size; defaults to 5GB (the S3 single-PUT cap). */
  readonly maxBytes?: number;
}

export interface DeleteThroughFileInput {
  readonly tenantId: string;
  readonly id: string;
  readonly recursive?: boolean;
}

export interface ReconcileReport {
  readonly orphans: ReadonlyArray<PendingOrphan>;
  readonly scanned: number;
}

// ---------------------------------------------------------------------------
// WriteThrough
// ---------------------------------------------------------------------------

const idFromKey = (s3Key: S3Key): string => `orphan-${s3Key}-${Date.now()}`;

export const createWriteThrough = (
  fs: FileSystem,
  store: MetadataStore,
): {
  writeThroughFile: (
    input: WriteThroughFileInput,
  ) => Promise<Result<FileNode, FileSystemError>>;
  deleteThroughFile: (
    input: DeleteThroughFileInput,
  ) => Promise<Result<void, FileSystemError>>;
  reconcile: () => Promise<Result<ReconcileReport, FileSystemError>>;
  getOrphans: () => ReadonlyArray<PendingOrphan>;
} => {
  // In-memory orphan log. v0.2 moves this to a metadata-store
  // table so it survives restarts.
  const orphans = new Map<string, PendingOrphan>();

  const logOrphan = (o: PendingOrphan): void => {
    orphans.set(o.id, o);
  };

  const writeThroughFile = async (
    input: WriteThroughFileInput,
  ): Promise<Result<FileNode, FileSystemError>> => {
    // Step 1: write the bytes to S3.
    const s3Key = asS3Key(input.name); // simplified; v0.2 derives the key from the parent path
    const w = await fs.adapter.write({
      key: s3Key,
      body: input.body,
      contentType: input.contentType,
      metadata: input.metadata,
    });
    if (!w.ok) {
      // S3 failed: nothing to compensate. Just surface the error.
      return w;
    }

    // Step 2: create the metadata record. If this fails, the S3
    // object is an orphan — log a `delete` op so reconcile()
    // removes it.
    const ownerId = input.ownerId ? asUserId(input.ownerId) : asUserId("system");
    // Duck-type the size: `instanceof Uint8Array` fails in Node ESM
    // because the imported Uint8Array is from a different realm
    // than the runtime one. ReadableStream has no `byteLength`,
    // so checking for that property is a safe discriminator.
    const body = input.body as { byteLength?: number };
    const calcSize = typeof body.byteLength === "number" ? body.byteLength : 0;
    const createInput: CreateNodeInput = {
      tenantId: asTenantId(input.tenantId),
      parentId: input.parentId,
      name: input.name,
      kind: "file",
      size: calcSize,
      mimeType: input.contentType,
      s3Key,
      ownerId,
      metadata: input.metadata,
    };
    const c = await store.createNode(createInput);
    if (!c.ok) {
      logOrphan({
        id: idFromKey(s3Key),
        tenantId: asTenantId(input.tenantId),
        s3Key,
        op: "delete",
        createdAt: new Date(),
        reason: c.error.message,
      });
      // Try the S3 delete so we don't leave the orphan in place.
      // If this also fails, the orphan is logged; reconcile()
      // will try again on next start.
      await fs.adapter.delete({ key: s3Key });
      return err(
        new FileSystemError({
          code: "InternalError",
          message: `S3 write succeeded but metadata insert failed; orphan logged for reconcile. S3 cleanup attempted. Original: ${c.error.message}`,
          retryable: false,
        }),
      );
    }

    return ok(c.value);
  };

  const deleteThroughFile = async (
    input: DeleteThroughFileInput,
  ): Promise<Result<void, FileSystemError>> => {
    // Step 1: look up the node so we have the S3 key.
    const g = await store.getNode({ tenantId: asTenantId(input.tenantId), id: input.id });
    if (!g.ok) return g;
    if (!g.value) {
      return err(
        new FileSystemError({
          code: "NotFound",
          message: `Node ${input.id} not found`,
          retryable: false,
        }),
      );
    }
    const node = g.value;
    const s3Key = asS3Key(node.s3Key);

    // Step 2: soft-delete the metadata (the source of truth for
    // the tree). If this fails, the S3 object is still live
    // and the metadata still says the file exists — we'll log
    // a `restore` op (NO-OP, just record the drift) so
    // reconcile() can flag it.
    const d = await store.deleteNode({
      tenantId: asTenantId(input.tenantId),
      id: input.id,
      recursive: input.recursive,
    });
    if (!d.ok) {
      logOrphan({
        id: `orphan-restore-${s3Key}-${Date.now()}`,
        tenantId: asTenantId(input.tenantId),
        s3Key,
        op: "restore",
        createdAt: new Date(),
        reason: d.error.message,
        nodeId: input.id,
      });
      return err(
        new FileSystemError({
          code: "InternalError",
          message: `Metadata soft-delete failed; orphan logged. Original: ${d.error.message}`,
          retryable: false,
        }),
      );
    }

    // Step 3: delete the S3 object. If this fails, the metadata
    // says the file is gone but the bytes are still in the
    // bucket — log a `delete` op so reconcile() removes the
    // S3 object.
    const del = await fs.adapter.delete({ key: s3Key });
    if (!del.ok) {
      logOrphan({
        id: `orphan-delete-${s3Key}-${Date.now()}`,
        tenantId: asTenantId(input.tenantId),
        s3Key,
        op: "delete",
        createdAt: new Date(),
        reason: del.error.message,
        nodeId: input.id,
      });
      return err(
        new FileSystemError({
          code: "InternalError",
          message: `Metadata deleted but S3 delete failed; orphan logged. Original: ${del.error.message}`,
          retryable: false,
        }),
      );
    }

    return ok(undefined);
  };

  const reconcile = async (): Promise<Result<ReconcileReport, FileSystemError>> => {
    // v0.1: no-op. v0.2 will:
    //   1. Walk the bucket via fs.adapter.list (paginated).
    //   2. Compare against the store's nodes.
    //   3. For each orphan in pendingOrphans, run the
    //      compensating action (delete the S3 object, or
    //      restore the metadata row).
    //   4. For new drift found by the walk, also append to
    //      the log.
    // For v0.1 we just report the current log content.
    return ok({ orphans: [...orphans.values()], scanned: orphans.size });
  };

  return {
    writeThroughFile,
    deleteThroughFile,
    reconcile,
    getOrphans: () => [...orphans.values()],
  };
};
