/**
 * S3CompatibleAdapter — the 13-method interface every storage
 * provider implements in `file-next`.
 *
 * Design reference: `sdd/file-next/design` §E.
 *
 * Why a custom interface instead of using the AWS SDK v3 `S3Client`
 * directly:
 *   1. **Provider portability** — Cloudflare R2, Backblaze B2, MinIO,
 *      and any future provider all speak the S3 wire protocol but
 *      expose it through different SDKs (or none at all). The
 *      interface is the single chokepoint; the rest of the codebase
 *      programs against the contract, not the SDK.
 *   2. **Result-typed returns** — every method returns
 *      `Promise<Result<T, FileSystemError>>`. No `try`/`catch` at
 *      call sites, no `any` smuggling, no swallowed rejections.
 *   3. **Testability** — the entire adapter can be replaced with a
 *      13-method mock in tests; the rest of the library (factory,
 *      MetadataStore, server actions) never has to know whether it
 *      is running against the real AWS SDK or a stub.
 *   4. **Stable wire shape** — the input/output types are pure data
 *      (no `Date` in the serialized form, no class instances), so
 *      they survive RSC serialization and the route-handler
 *      boundary.
 *
 * Method count is a deliberate design choice: see
 * `sdd/file-next/design/decision/adapter-method-count`. The 13th
 * method (`getPublicUrl`) is intentionally separate from the
 * presigned-URL family so that providers which can't issue presigned
 * URLs (public buckets, local dev backends) can still satisfy the
 * shape by returning a plain URL.
 *
 * Conventions:
 *   - All methods are async (returning `Promise<Result<...>>`).
 *   - All methods take a single typed input object (no positional
 *     args beyond the first) so future fields are non-breaking.
 *   - All key-bearing inputs use the `S3Key` brand; all prefix-
 *     bearing inputs use the `Prefix` brand.
 *   - Errors are always `FileSystemError` (the 11-code catalog from
 *     `@/errors`). Provider-specific codes (S3 `NoSuchKey`, etc.)
 *     go on `cause.code`, not on the top-level `code`.
 */

import type { Result } from "@/types/result";
import type { FileSystemError } from "@/errors";
import type { S3Key, Prefix } from "@/types/branded";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface ListInput {
  /** S3 prefix to list under. Empty string is the bucket root. */
  prefix?: Prefix;
  /** Opaque continuation token from a prior `ListOutput`. */
  continuationToken?: string;
  /** Soft cap on the number of items returned. Providers may honor or ignore. */
  limit?: number;
}

export interface ReadInput {
  key: S3Key;
  /** Optional byte range (`bytes=0-1023`). Provider-specific semantics. */
  range?: string;
}

export interface WriteInput {
  key: S3Key;
  body: Uint8Array | ReadableStream<Uint8Array>;
  contentType?: string;
  /** Free-form user metadata stored alongside the object. */
  metadata?: Record<string, string>;
}

export interface DeleteInput {
  key: S3Key;
}

export interface MoveInput {
  sourceKey: S3Key;
  destinationKey: S3Key;
}

export interface CopyInput {
  sourceKey: S3Key;
  destinationKey: S3Key;
}

export interface StatInput {
  key: S3Key;
}

export interface ExistsInput {
  key: S3Key;
}

export interface GetMetadataInput {
  key: S3Key;
}

export interface SetMetadataInput {
  key: S3Key;
  metadata: Record<string, string>;
  /**
   * `false` (default) merges with existing user metadata; `true`
   * replaces it entirely. Provider semantics may differ; adapters
   * normalize.
   */
  replace?: boolean;
}

export interface PresignedUploadInput {
  key: S3Key;
  contentType?: string;
  /** Expiry in seconds. Providers enforce a max (e.g. 7 days for S3). */
  expiresIn?: number;
}

export interface PresignedDownloadInput {
  key: S3Key;
  expiresIn?: number;
}

export interface GetPublicUrlInput {
  key: S3Key;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface ListOutput {
  items: Array<{ key: S3Key; size: number; lastModified: Date }>;
  /** Sub-prefixes discovered under `prefix` (S3 CommonPrefixes). */
  prefixes: Array<Prefix>;
  /** Opaque token; `undefined` means the listing is complete. */
  nextContinuationToken?: string;
}

export interface ReadOutput {
  body: Uint8Array;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface WriteOutput {
  etag: string;
  versionId?: string;
}

export interface DeleteOutput {
  [k: string]: unknown;
}

/**
 * Side-effect outputs are intentionally empty `{}`. Providers MAY
 * populate additional fields (etag, versionId, existed, ...) in
 * practice, but the interface contract is the minimum guarantee.
 * Callers needing provider-specific metadata should use `stat` or
 * `getMetadata` instead.
 */
export interface MoveOutput {
  [k: string]: unknown;
}

export interface CopyOutput {
  [k: string]: unknown;
}

export interface StatOutput {
  key: S3Key;
  size: number;
  etag: string;
  contentType: string;
  lastModified: Date;
  metadata: Record<string, string>;
}

export interface ExistsOutput {
  exists: boolean;
}

export interface GetMetadataOutput {
  [k: string]: unknown;
}

export interface SetMetadataOutput {
  [k: string]: unknown;
}

export interface PresignedUploadOutput {
  url: string;
  method: "PUT" | "POST";
  /** Required HTTP headers the client MUST send on the upload. */
  requiredHeaders?: Record<string, string>;
}

export interface PresignedDownloadOutput {
  url: string;
}

export interface GetPublicUrlOutput {
  url: string;
}

// ---------------------------------------------------------------------------
// The interface
// ---------------------------------------------------------------------------

/**
 * The 13-method contract every storage provider implements. The
 * count is enforced by `packages/core/tests/storage/adapter.test.ts`
 * (defensive — catches accidental additions/removals).
 */
export interface S3CompatibleAdapter {
  // -- object discovery -----------------------------------------------------
  list(input: ListInput): Promise<Result<ListOutput, FileSystemError>>;

  // -- single-object CRUD ---------------------------------------------------
  read(input: ReadInput): Promise<Result<ReadOutput, FileSystemError>>;
  write(input: WriteInput): Promise<Result<WriteOutput, FileSystemError>>;
  delete(input: DeleteInput): Promise<Result<DeleteOutput, FileSystemError>>;
  move(input: MoveInput): Promise<Result<MoveOutput, FileSystemError>>;
  copy(input: CopyInput): Promise<Result<CopyOutput, FileSystemError>>;

  // -- metadata + status ----------------------------------------------------
  stat(input: StatInput): Promise<Result<StatOutput, FileSystemError>>;
  exists(input: ExistsInput): Promise<Result<ExistsOutput, FileSystemError>>;
  getMetadata(
    input: GetMetadataInput,
  ): Promise<Result<GetMetadataOutput, FileSystemError>>;
  setMetadata(
    input: SetMetadataInput,
  ): Promise<Result<SetMetadataOutput, FileSystemError>>;

  // -- URL family -----------------------------------------------------------
  createPresignedUploadUrl(
    input: PresignedUploadInput,
  ): Promise<Result<PresignedUploadOutput, FileSystemError>>;
  createPresignedDownloadUrl(
    input: PresignedDownloadInput,
  ): Promise<Result<PresignedDownloadOutput, FileSystemError>>;
  getPublicUrl(
    input: GetPublicUrlInput,
  ): Promise<Result<GetPublicUrlOutput, FileSystemError>>;
}
