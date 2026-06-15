/**
 * Public entry point for the `file-next` library.
 *
 * Public API for v0.1 PR 1 (foundation):
 *   - `Result<T, E>` and its helpers (ok / err / map / mapErr / andThen / unwrap / unwrapOr)
 *   - `FileSystemError` + the 11 code catalog + the fromAws / fromPg / fromSqlite mappers
 *   - Branded nominal types (Path, Prefix, S3Key, TenantId, UserId) and their as* / assert* guards
 *   - The Tailwind `cn` utility (shared with shadcn consumers)
 *
 * The storage adapter (S3CompatibleAdapter), the metadata store, the
 * server actions, and the headless hooks land in later PRs (PR 2a+).
 * Re-exports are added here as the API stabilizes.
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
