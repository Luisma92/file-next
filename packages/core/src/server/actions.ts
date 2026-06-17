/**
 * Server actions — the typed, validated surface that Next.js
 * server components and form actions call.
 *
 * The 5 actions are thin wrappers around the metadata store +
 * the write-through layer. They:
 *   - Validate inputs with Zod (the same schema the consumer
 *     can use for form validation)
 *   - Run the operation
 *   - Return \`Result<T, FileSystemError>\` (never throw — the
 *     RSC boundary serializes errors into a stable shape)
 *
 * Consumer pattern:
 *   \`\`\`ts
 *   // app/actions.ts
 *   'use server';
 *   import { listFilesAction } from 'file-next/server';
 *   export { listFilesAction };
 *   \`\`\`
 *
 * Each action is independent; the consumer can pick which to
 * expose. The \`serverOnly\` wrapper (added in the `server`
 * entry point) marks the whole module as server-only via
 * \`import "server-only"\` so a careless client import fails
 * the build.
 *
 * v0.1 scope:
 *   - All 5 actions implemented
 *   - Move/copy are METADATA-ONLY (the S3 bytes are not moved
 *     or copied by these actions). The S3 layer is the
 *     consumer's responsibility (call \`fs.adapter.move\` /
 *     \`copy\` separately). v0.2 adds S3-aware versions.
 *   - No withAuth composition: the consumer wraps the action
 *     with withAuth in their own code (the auth story is the
 *     consumer's choice of provider).
 */
import { z } from "zod";
import { ok, err, type Result } from "@/types/result";
import { FileSystemError } from "@/errors";
import { asTenantId, type TenantId } from "@/types/branded";
import type { MetadataStore, FileNode } from "../metadata/store";
import type { createWriteThrough } from "../sync/write-through";
type CreateWriteThrough = ReturnType<typeof createWriteThrough>;

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const TenantIdSchema = z.string().min(1, "tenantId is required");
const NodeIdSchema = z.string().min(1, "id is required");
const PathSchema = z.string().nullable(); // null for root

export const ListFilesInputSchema = z.object({
  tenantId: TenantIdSchema,
  parentId: PathSchema,
  limit: z.number().int().positive().optional(),
});

export const DeleteFileInputSchema = z.object({
  tenantId: TenantIdSchema,
  id: NodeIdSchema,
  recursive: z.boolean().optional(),
});

export const MoveFileInputSchema = z.object({
  tenantId: TenantIdSchema,
  id: NodeIdSchema,
  newParentId: PathSchema,
  newName: z.string().min(1).optional(),
});

export const CopyFileInputSchema = z.object({
  tenantId: TenantIdSchema,
  id: NodeIdSchema,
  newParentId: PathSchema,
  newName: z.string().min(1).optional(),
});

export const SetMetadataInputSchema = z.object({
  tenantId: TenantIdSchema,
  id: NodeIdSchema,
  metadata: z.record(z.string()),
  replace: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Action factories
//
// Each action is a FUNCTION FACTORY that takes the store (and
// writeThrough where needed) and returns the actual async
// action. The factory pattern lets the consumer wire the
// dependencies once at app init and re-use them per request.
//
//   const actions = createServerActions({ store, writeThrough });
//   await actions.listFiles({ tenantId: 'acme', parentId: null });
// ---------------------------------------------------------------------------

export interface ServerActionsDeps {
  readonly store: MetadataStore;
  readonly writeThrough: CreateWriteThrough;
}

export const createServerActions = (deps: ServerActionsDeps) => {
  const { store, writeThrough } = deps;

  // Helper: wrap a thrown error in a typed FileSystemError.
  const wrap = (e: unknown, code: FileSystemError["code"], message: string): FileSystemError => {
    if (e instanceof FileSystemError) return e;
    return new FileSystemError({
      code,
      message: `${message}: ${e instanceof Error ? e.message : String(e)}`,
      retryable: true,
    });
  };

  // -------------------------------------------------------------------------
  // listFilesAction — metadata-first (fast; no S3 call)
  // -------------------------------------------------------------------------
  const listFiles = async (input: z.infer<typeof ListFilesInputSchema>): Promise<Result<ListFilesOutput, FileSystemError>> => {
    const parsed = ListFilesInputSchema.safeParse(input);
    if (!parsed.success) {
      return err(
        new FileSystemError({
          code: "InternalError",
          message: "Invalid listFiles input",
          retryable: false,
          cause: { code: "ZodError", message: parsed.error.message, issues: parsed.error.issues },
        }),
      );
    }
    try {
      const r = await store.listChildren({
        tenantId: asTenantId(parsed.data.tenantId),
        parentId: parsed.data.parentId,
        limit: parsed.data.limit,
      });
      if (!r.ok) return r;
      return ok({
        items: r.value.items,
        nextCursor: r.value.nextCursor,
      });
    } catch (e) {
      return err(wrap(e, "InternalError", "listFiles failed"));
    }
  };

  // -------------------------------------------------------------------------
  // deleteFileAction — cascades metadata + S3
  // -------------------------------------------------------------------------
  const deleteFile = async (input: z.infer<typeof DeleteFileInputSchema>): Promise<Result<void, FileSystemError>> => {
    const parsed = DeleteFileInputSchema.safeParse(input);
    if (!parsed.success) {
      return err(
        new FileSystemError({
          code: "InternalError",
          message: "Invalid deleteFile input",
          retryable: false,
          cause: { code: "ZodError", message: parsed.error.message, issues: parsed.error.issues },
        }),
      );
    }
    try {
      return await writeThrough.deleteThroughFile({
        tenantId: parsed.data.tenantId,
        id: parsed.data.id,
        recursive: parsed.data.recursive,
      });
    } catch (e) {
      return err(wrap(e, "InternalError", "deleteFile failed"));
    }
  };

  // -------------------------------------------------------------------------
  // moveFileAction — metadata-only in v0.1; the consumer must
  // call fs.adapter.move/copy separately for the S3 bytes.
  // v0.2 adds an S3-aware version (use writeThrough).
  // -------------------------------------------------------------------------
  const moveFile = async (input: z.infer<typeof MoveFileInputSchema>): Promise<Result<FileNode, FileSystemError>> => {
    const parsed = MoveFileInputSchema.safeParse(input);
    if (!parsed.success) {
      return err(
        new FileSystemError({
          code: "InternalError",
          message: "Invalid moveFile input",
          retryable: false,
          cause: { code: "ZodError", message: parsed.error.message, issues: parsed.error.issues },
        }),
      );
    }
    try {
      return await store.moveNode({
        tenantId: asTenantId(parsed.data.tenantId),
        id: parsed.data.id,
        newParentId: parsed.data.newParentId,
        newName: parsed.data.newName,
      });
    } catch (e) {
      return err(wrap(e, "InternalError", "moveFile failed"));
    }
  };

  // -------------------------------------------------------------------------
  // copyFileAction — creates a new metadata node referencing
  // the SAME s3Key. v0.1 does NOT duplicate the S3 bytes (the
  // consumer can use fs.adapter.copy for that). v0.2 adds
  // an S3-aware version that does copy + create.
  // -------------------------------------------------------------------------
  const copyFile = async (input: z.infer<typeof CopyFileInputSchema>): Promise<Result<FileNode, FileSystemError>> => {
    const parsed = CopyFileInputSchema.safeParse(input);
    if (!parsed.success) {
      return err(
        new FileSystemError({
          code: "InternalError",
          message: "Invalid copyFile input",
          retryable: false,
          cause: { code: "ZodError", message: parsed.error.message, issues: parsed.error.issues },
        }),
      );
    }
    try {
      // Get the source node
      const g = await store.getNode({ tenantId: asTenantId(parsed.data.tenantId), id: parsed.data.id });
      if (!g.ok) return g;
      if (!g.value) {
        return err(
          new FileSystemError({
            code: "NotFound",
            message: `Node ${parsed.data.id} not found`,
            retryable: false,
          }),
        );
      }
      const src = g.value;
      // Create a new node referencing the same s3Key + metadata
      const created = await store.createNode({
        tenantId: asTenantId(parsed.data.tenantId),
        parentId: parsed.data.newParentId,
        name: parsed.data.newName ?? src.name,
        kind: src.kind,
        size: src.size,
        mimeType: src.mimeType,
        s3Key: src.s3Key, // share the S3 object
        ownerId: src.ownerId,
        metadata: src.metadata,
      });
      return created;
    } catch (e) {
      return err(wrap(e, "InternalError", "copyFile failed"));
    }
  };

  // -------------------------------------------------------------------------
  // setMetadataAction — store.updateMetadata
  // -------------------------------------------------------------------------
  const setMetadata = async (input: z.infer<typeof SetMetadataInputSchema>): Promise<Result<FileNode, FileSystemError>> => {
    const parsed = SetMetadataInputSchema.safeParse(input);
    if (!parsed.success) {
      return err(
        new FileSystemError({
          code: "InternalError",
          message: "Invalid setMetadata input",
          retryable: false,
          cause: { code: "ZodError", message: parsed.error.message, issues: parsed.error.issues },
        }),
      );
    }
    try {
      return await store.updateMetadata({
        tenantId: asTenantId(parsed.data.tenantId),
        id: parsed.data.id,
        metadata: parsed.data.metadata,
        replace: parsed.data.replace,
      });
    } catch (e) {
      return err(wrap(e, "InternalError", "setMetadata failed"));
    }
  };

  return { listFiles, deleteFile, moveFile, copyFile, setMetadata };
};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface ListFilesOutput {
  readonly items: ReadonlyArray<FileNode>;
  readonly nextCursor?: string;
}
