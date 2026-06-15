/**
 * Upstream error mappers for FileSystemError.
 *
 * Each mapper is a pure function `(*unknown) -> FileSystemError`.
 * The class re-exposes them as static methods (FileSystemError.fromAws
 * etc.) so callers can pick the import style that fits.
 *
 * Mapping strategy:
 *   1. If the input is already a FileSystemError, return it as-is
 *      (we never re-wrap our own errors).
 *   2. Try the most specific signal first: S3 `name`, Postgres
 *      SQLSTATE, SQLite extended code.
 *   3. Fall back to the HTTP status code (AWS SDK v3 exposes
 *      `$metadata.httpStatusCode`).
 *   4. Last resort: InternalError, retryable, with the original
 *      payload in `cause`.
 *
 * Provider-specific codes are preserved on `cause.code` (e.g. S3
 * "NoSuchKey", Postgres "23505") so callers can still branch on
 * them while the top-level `code` stays in the 11-code spec catalog.
 *
 * Mapping notes (post-C' merge, see
 * `sdd/file-next/decisions/error-codes-deviation`):
 *   - S3 `SlowDown`     -> QuotaExceeded (broader than RateLimited;
 *                          SlowDown means reduce request rate, which
 *                          is conceptually quota pressure, not
 *                          throttling of a single call).
 *   - S3 `BadDigest`    -> ChecksumMismatch (checksum verified by
 *                          S3 on upload did not match the client).
 *   - HTTP 429          -> RateLimited (was QuotaExceeded in the
 *                          pre-C' catalog; RateLimited is the more
 *                          specific code for throttling responses).
 *   - HTTP 408          -> NetworkError (transient transport error).
 *   - HTTP 400 / Postgres 23514 / S3 InvalidRequest
 *                       -> fall through to the 4xx branch (no
 *                          top-level 400 code in the C' catalog;
 *                          these inputs are usually caught by the
 *                          name/SQLSTATE mapping first anyway).
 */

import { FileSystemError, type FileSystemErrorCode } from "./index";

/* ---------------------------------------------------------------- *
 * Mapping tables (private)                                          *
 * ---------------------------------------------------------------- */

interface CodeMapping {
  code: FileSystemErrorCode;
  retryable: boolean;
}

const HTTP_STATUS_TO_CODE: Readonly<Record<number, CodeMapping>> = {
  401: { code: "Unauthorized", retryable: false },
  403: { code: "Forbidden", retryable: false },
  404: { code: "NotFound", retryable: false },
  408: { code: "NetworkError", retryable: true },
  409: { code: "Conflict", retryable: false },
  413: { code: "PayloadTooLarge", retryable: false },
  415: { code: "UnsupportedMediaType", retryable: false },
  429: { code: "RateLimited", retryable: true },
};

const AWS_NAME_TO_CODE: Readonly<Record<string, CodeMapping>> = {
  NoSuchKey: { code: "NotFound", retryable: false },
  NoSuchBucket: { code: "NotFound", retryable: false },
  AccessDenied: { code: "Forbidden", retryable: false },
  SlowDown: { code: "QuotaExceeded", retryable: true },
  BadDigest: { code: "ChecksumMismatch", retryable: true },
  XAmzContentSHA256Mismatch: { code: "ChecksumMismatch", retryable: true },
  NetworkingError: { code: "NetworkError", retryable: true },
  TimeoutError: { code: "NetworkError", retryable: true },
};

const PG_SQLSTATE_TO_CODE: Readonly<Record<string, CodeMapping>> = {
  "23505": { code: "Conflict", retryable: false },
};

const SQLITE_CODE_TO_CODE: Readonly<Record<string, CodeMapping>> = {
  SQLITE_CONSTRAINT_UNIQUE: { code: "Conflict", retryable: false },
  SQLITE_CONSTRAINT_PRIMARYKEY: { code: "Conflict", retryable: false },
};

/* ---------------------------------------------------------------- *
 * Public mappers                                                    *
 * ---------------------------------------------------------------- */

const toCause = (code: string, message: string, extra?: Record<string, unknown>) => ({
  code,
  message,
  ...(extra ?? {}),
});

const fallback = (err: unknown): FileSystemError =>
  new FileSystemError({
    code: "InternalError",
    message: err instanceof Error ? err.message : String(err),
    retryable: true,
    cause: toCause(
      "Unknown",
      err instanceof Error ? err.message : String(err),
    ),
  });

export const fromAws = (err: unknown): FileSystemError => {
  if (err instanceof FileSystemError) return err;

  if (typeof err !== "object" || err === null) return fallback(err);

  const awsErr = err as {
    name?: unknown;
    message?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  const name = typeof awsErr.name === "string" ? awsErr.name : undefined;
  const message =
    typeof awsErr.message === "string" ? awsErr.message : `AWS error: ${name ?? "unknown"}`;
  const status =
    typeof awsErr.$metadata?.httpStatusCode === "number"
      ? awsErr.$metadata.httpStatusCode
      : undefined;

  const cause = toCause(
    name ?? (status !== undefined ? String(status) : "Unknown"),
    message,
    status !== undefined ? { httpStatusCode: status } : undefined,
  );

  // 1) name-based mapping wins (more specific than HTTP status)
  if (name && name in AWS_NAME_TO_CODE) {
    const m = AWS_NAME_TO_CODE[name]!;
    return new FileSystemError({ code: m.code, message, retryable: m.retryable, cause });
  }

  // 2) HTTP status mapping
  if (status !== undefined && status in HTTP_STATUS_TO_CODE) {
    const m = HTTP_STATUS_TO_CODE[status]!;
    return new FileSystemError({ code: m.code, message, retryable: m.retryable, cause });
  }

  // 3) 5xx bucket
  if (status !== undefined && status >= 500 && status < 600) {
    return new FileSystemError({ code: "InternalError", message, retryable: true, cause });
  }

  // 4) anything else 4xx-shaped
  if (status !== undefined && status >= 400 && status < 500) {
    return new FileSystemError({ code: "Forbidden", message, retryable: false, cause });
  }

  return new FileSystemError({ code: "InternalError", message, retryable: true, cause });
};

export const fromPg = (err: unknown): FileSystemError => {
  if (err instanceof FileSystemError) return err;

  if (typeof err !== "object" || err === null) return fallback(err);

  const pgErr = err as { code?: unknown; message?: unknown };
  const sqlstate = typeof pgErr.code === "string" ? pgErr.code : undefined;
  const message =
    typeof pgErr.message === "string" ? pgErr.message : `Postgres error: ${sqlstate ?? "unknown"}`;
  const cause = toCause(sqlstate ?? "Unknown", message);

  if (sqlstate && sqlstate in PG_SQLSTATE_TO_CODE) {
    const m = PG_SQLSTATE_TO_CODE[sqlstate]!;
    return new FileSystemError({ code: m.code, message, retryable: m.retryable, cause });
  }

  return new FileSystemError({ code: "InternalError", message, retryable: true, cause });
};

export const fromSqlite = (err: unknown): FileSystemError => {
  if (err instanceof FileSystemError) return err;

  if (typeof err !== "object" || err === null) return fallback(err);

  const sqlErr = err as { code?: unknown; message?: unknown };
  const code = typeof sqlErr.code === "string" ? sqlErr.code : undefined;
  const message =
    typeof sqlErr.message === "string" ? sqlErr.message : `SQLite error: ${code ?? "unknown"}`;
  const cause = toCause(code ?? "Unknown", message);

  if (code && code in SQLITE_CODE_TO_CODE) {
    const m = SQLITE_CODE_TO_CODE[code]!;
    return new FileSystemError({ code: m.code, message, retryable: m.retryable, cause });
  }

  return new FileSystemError({ code: "InternalError", message, retryable: true, cause });
};
