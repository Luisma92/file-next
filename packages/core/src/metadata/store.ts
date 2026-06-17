/**
 * `MetadataStore` — the pure-TS interface every concrete store
 * implements (memory, SQLite, Postgres).
 *
 * The store is the secondary metadata index. It mirrors the S3
 * file tree so callers can list/search/sort WITHOUT a ListObjectsV2
 * call (which is slow and expensive at scale). The S3 bucket
 * remains the source of truth for object bytes; the store is
 * the source of truth for tree structure, search indexes, and
 * tenant scoping.
 *
 * Design references:
 *   - `sdd/file-next/design` §F (the 9-method contract)
 *   - `sdd/file-next/architecture/byodb-metadata-store` (hexagonal)
 *   - `sdd/file-next/decisions/error-codes-deviation` (C' catalog)
 *
 * Tenant isolation: every method takes an explicit \`tenantId\`
 * parameter. The Postgres adapter enforces isolation at the DB
 * level via \`SET LOCAL app.current_tenant\` + RLS; the SQLite
 * and memory adapters filter by tenantId in app code (no
 * structural isolation, but a single-tenant test DB can be used
 * safely).
 */
import type { Result } from "@/types/result";
import type { FileSystemError } from "@/errors";
import type { TenantId, UserId } from "@/types/branded";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** The kind of node in the file tree. */
export type NodeKind = "file" | "folder";

/**
 * A single node in the metadata tree. The S3 object bytes are NOT
 * here (they live in the bucket); this is the tree + application
 * metadata that the consumer needs to render a file browser.
 */
export interface FileNode {
  /** Globally unique node id (UUID v4 in production). */
  readonly id: string;
  /** Owning tenant. */
  readonly tenantId: TenantId;
  /** Parent node id; null for the root. */
  readonly parentId: string | null;
  /** Display name (the last path segment). */
  readonly name: string;
  /** Full POSIX path from the root (materialized for fast lookups). */
  readonly path: string;
  /** File or folder. */
  readonly kind: NodeKind;
  /** Object size in bytes (0 for folders). */
  readonly size: number;
  /** MIME type (empty for folders). */
  readonly mimeType: string;
  /** The S3 key for the object (empty for folders). */
  readonly s3Key: string;
  /** Owning user (the creator; ownership is sticky unless explicitly transferred). */
  readonly ownerId: UserId;
  /** Application-defined user metadata. */
  readonly metadata: Readonly<Record<string, string>>;
  /** ISO timestamp. */
  readonly createdAt: Date;
  /** ISO timestamp. */
  readonly updatedAt: Date;
  /** Soft-delete tombstone. null = live. */
  readonly deletedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateNodeInput {
  readonly tenantId: TenantId;
  readonly parentId: string | null;
  readonly name: string;
  readonly kind: NodeKind;
  readonly size: number;
  readonly mimeType: string;
  readonly s3Key: string;
  readonly ownerId: UserId;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface GetNodeInput {
  readonly tenantId: TenantId;
  readonly id: string;
}

export interface ListChildrenInput {
  readonly tenantId: TenantId;
  readonly parentId: string | null;
  /** Optional cursor for pagination; opaque to consumers. */
  readonly cursor?: string;
  /** Soft cap; the adapter may honor or ignore. */
  readonly limit?: number;
}

export interface MoveNodeInput {
  readonly tenantId: TenantId;
  readonly id: string;
  /** New parent (null = root). */
  readonly newParentId: string | null;
  /** New display name (rename). If omitted, the name is preserved. */
  readonly newName?: string;
}

export interface DeleteNodeInput {
  readonly tenantId: TenantId;
  readonly id: string;
  /**
   * If true, recursively delete the subtree. If false (default),
   * a non-empty folder returns Conflict.
   */
  readonly recursive?: boolean;
}

export interface UpdateMetadataInput {
  readonly tenantId: TenantId;
  readonly id: string;
  /** User metadata to merge. */
  readonly metadata: Readonly<Record<string, string>>;
  /** true = replace the entire metadata map; false (default) = merge. */
  readonly replace?: boolean;
}

export interface SearchInput {
  readonly tenantId: TenantId;
  /** Case-insensitive substring matched against the node name. */
  readonly query: string;
  /** Optional scope: search only within a folder subtree. */
  readonly parentId?: string;
  readonly limit?: number;
}

export interface GetPathInput {
  readonly tenantId: TenantId;
  readonly id: string;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface ListChildrenOutput {
  readonly items: ReadonlyArray<FileNode>;
  /** Opaque cursor; undefined = listing is complete. */
  readonly nextCursor?: string;
}

export interface GetPathOutput {
  /** The path from root to the target node, root-first. */
  readonly segments: ReadonlyArray<FileNode>;
}

export interface ReconcileResult {
  /** Nodes in the store that had no matching S3 object. */
  readonly orphansInStore: ReadonlyArray<string>;
  /** S3 keys that had no matching store row. */
  readonly orphansInS3: ReadonlyArray<string>;
  /** Total nodes considered. */
  readonly scanned: number;
}

// ---------------------------------------------------------------------------
// The 9-method interface
// ---------------------------------------------------------------------------

export interface MetadataStore {
  /** Create a new node. Returns Conflict on a duplicate (parentId, name). */
  createNode(
    input: CreateNodeInput,
  ): Promise<Result<FileNode, FileSystemError>>;

  /** Get a node by id. Returns ok(null) when not found (NOT NotFound). */
  getNode(
    input: GetNodeInput,
  ): Promise<Result<FileNode | null, FileSystemError>>;

  /** List children of a folder, ordered by name. */
  listChildren(
    input: ListChildrenInput,
  ): Promise<Result<ListChildrenOutput, FileSystemError>>;

  /**
   * Move a node to a new parent and/or rename it. Updates the
   * materialized path for the node AND its descendants (cascades).
   */
  moveNode(input: MoveNodeInput): Promise<Result<FileNode, FileSystemError>>;

  /**
   * Soft-delete a node (sets deletedAt). Recursive deletion
   * tombstones the entire subtree in one call.
   */
  deleteNode(input: DeleteNodeInput): Promise<Result<void, FileSystemError>>;

  /** Update user metadata (merge or replace). */
  updateMetadata(
    input: UpdateMetadataInput,
  ): Promise<Result<FileNode, FileSystemError>>;

  /** Case-insensitive name search within an optional folder scope. */
  search(input: SearchInput): Promise<Result<ListChildrenOutput, FileSystemError>>;

  /**
   * Walk the parent chain and return the path from root to the
   * target node. The result includes the target itself as the
   * last segment.
   */
  getPath(input: GetPathInput): Promise<Result<GetPathOutput, FileSystemError>>;

  /**
   * Reconcile the store against an external source of truth
   * (S3 bucket walk). Returns the drift set. The memory adapter
   * is a no-op (no external source); SQLite/Postgres walk the
   * bucket via the adapter and compare.
   */
  reconcile(): Promise<Result<ReconcileResult, FileSystemError>>;
}
