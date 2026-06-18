/**
 * Public entry point for the `file-next` library.
 *
 * Public API for v0.1 PR 2a (storage skeleton):
 *   - `Result<T, E>` and its helpers (ok / err / map / mapErr / andThen / unwrap / unwrapOr)
 *   - `FileSystemError` + the 11 code catalog + the fromAws / fromPg / fromSqlite mappers
 *   - Branded nominal types (Path, Prefix, S3Key, TenantId, UserId) and their as* / assert* guards
 *   - The Tailwind `cn` utility (shared with shadcn consumers)
 *   - `S3CompatibleAdapter` — the 13-method interface every provider implements
 *     (S3, R2, future Backblaze B2 / MinIO)
 *   - The `FileSystem` container type (adapter + config + metadata + forTenant)
 *   - Adapter input/output types (List, Read, Write, Stat, PresignedURL, ...)
 *
 * The factory (`createFileSystem`), the env singleton (`getFileSystem`),
 * the concrete S3 / R2 adapters, the metadata store, the server
 * actions, and the headless hooks land in later PRs (PR 2a tasks
 * T-010/T-011 land here, PR 2b adds the concrete adapters, PR 3+ adds
 * the rest).
 */

export type {
  Result,
} from "./types/result";

export {
  ok,
  err,
  map,
  mapErr,
  andThen,
  unwrap,
  unwrapOr,
} from "./types/result";

export {
  FileSystemError,
  FILE_SYSTEM_ERROR_CODES,
  RETRYABLE_BY_CODE,
  fromAws,
  fromPg,
  fromSqlite,
} from "./errors";

export type {
  FileSystemErrorCode,
  FileSystemErrorOptions,
  FileSystemErrorJson,
} from "./errors";

export type {
  Path,
  Prefix,
  S3Key,
  TenantId,
  UserId,
} from "./types/branded";

export {
  asPath,
  assertPath,
  asPrefix,
  assertPrefix,
  asS3Key,
  assertS3Key,
  asTenantId,
  assertTenantId,
  asUserId,
  assertUserId,
} from "./types/branded";

export { cn } from "./lib/cn";

export type {
  S3CompatibleAdapter,
  ListInput,
  ListOutput,
  ReadInput,
  ReadOutput,
  WriteInput,
  WriteOutput,
  DeleteInput,
  DeleteOutput,
  MoveInput,
  MoveOutput,
  CopyInput,
  CopyOutput,
  StatInput,
  StatOutput,
  ExistsInput,
  ExistsOutput,
  GetMetadataInput,
  GetMetadataOutput,
  SetMetadataInput,
  SetMetadataOutput,
  PresignedUploadInput,
  PresignedUploadOutput,
  PresignedDownloadInput,
  PresignedDownloadOutput,
  GetPublicUrlInput,
  GetPublicUrlOutput,
} from "./storage/adapter";

export type { FileSystem } from "./storage/filesystem";
export { createFileSystem } from "./storage/factory";
export { getFileSystem, _resetFileSystemForTests } from "./storage/singleton";
export {
  createMemoryAdapter,
  type MemoryAdapterOptions,
  type MemoryStoreSnapshot,
} from "./storage/memory-adapter";
export type {
  FileSystemConfig,
  S3Config,
  R2Config,
  Credentials,
} from "./storage/config";
export type { MetadataStore } from "./metadata/store";

// PR 4a: metadata store
export { createMemoryStore } from "./metadata";
export type {
  FileNode,
  NodeKind,
  CreateNodeInput,
  GetNodeInput,
  ListChildrenInput,
  ListChildrenOutput,
  MoveNodeInput,
  DeleteNodeInput,
  UpdateMetadataInput,
  SearchInput,
  GetPathInput,
  GetPathOutput,
  ReconcileResult,
} from "./metadata";
