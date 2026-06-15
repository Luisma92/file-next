/**
 * FileSystemError — the single error class every adapter, store,
 * server action, and route handler in `file-next` returns or throws.
 *
 * Spec reference: requirement "FileSystemError discriminated union"
 * in `sdd/file-next/spec`. The 11 codes are the CLOSED set; any
 * provider-specific code (e.g. S3 `NoSuchKey`, Postgres `23505`) is
 * preserved on `cause.code` so callers can still distinguish upstream
 * reasons while the top-level `code` stays in the catalog.
 *
 * Retryability table is the design's `error-mapping` excerpt; see
 * `sdd/file-next/design` §C. Any future code MUST add an entry in
 * `RETRYABLE_BY_CODE` (the catalog test enforces this).
 *
 * The placeholder from T-006 is replaced by this file in T-007a.
 * The upstream mappers (fromAws / fromPg / fromSqlite) land in T-007b
 * in `mappers.ts`.
 */

export const FILE_SYSTEM_ERROR_CODES = [
  "NotFound",
  "Forbidden",
  "Conflict",
  "QuotaExceeded",
  "NetworkError",
  "InternalError",
  "ValidationError",
  "MissingConfig",
  "PayloadTooLarge",
  "UnsupportedMediaType",
  "Unauthorized",
] as const satisfies readonly string[];

export type FileSystemErrorCode = (typeof FILE_SYSTEM_ERROR_CODES)[number];

export const RETRYABLE_BY_CODE: Readonly<Record<FileSystemErrorCode, boolean>> = {
  NotFound: false,
  Forbidden: false,
  Conflict: false,
  QuotaExceeded: true,
  NetworkError: true,
  InternalError: true,
  ValidationError: false,
  MissingConfig: false,
  PayloadTooLarge: false,
  UnsupportedMediaType: false,
  Unauthorized: false,
};

export interface FileSystemErrorOptions {
  code: FileSystemErrorCode;
  message: string;
  retryable: boolean;
  cause?: { code: string; message: string; [k: string]: unknown };
}

export interface FileSystemErrorJson {
  name: string;
  code: FileSystemErrorCode;
  message: string;
  retryable: boolean;
  cause?: { code: string; message: string; [k: string]: unknown };
}

export class FileSystemError extends Error {
  readonly code: FileSystemErrorCode;
  readonly retryable: boolean;
  override readonly cause?: { code: string; message: string; [k: string]: unknown };

  constructor(opts: FileSystemErrorOptions) {
    super(opts.message);
    this.name = "FileSystemError";
    this.code = opts.code;
    this.retryable = opts.retryable;
    if (opts.cause !== undefined) {
      this.cause = opts.cause;
    }
  }

  /**
   * Stable JSON shape for RSC pass-through. Error.prototype.message
   * is non-enumerable, so plain `JSON.stringify(err)` would emit `{}`
   * and lose the message + code + retryable flag. `cause` is omitted
   * entirely (not set to undefined) when absent so the shape stays
   * stable for hash-based caches.
   */
  toJSON(): FileSystemErrorJson {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.cause !== undefined ? { cause: this.cause } : {}),
    };
  }

  /**
   * Mappers from upstream error shapes (AWS SDK v3, node-postgres,
   * better-sqlite3) to FileSystemError. See `./mappers.ts` for the
   * mapping tables. Re-exposed as static methods so callers can pick
   * the import style that fits; the free functions are the canonical
   * implementation.
   */
  static fromAws(err: unknown): FileSystemError {
    // Lazy import via the runtime binding avoids the static-field
    // circular-dep trap in ESM. The mapper file imports this class
    // for instanceof checks; we look up the function at call time.
    return _fromAws(err);
  }

  static fromPg(err: unknown): FileSystemError {
    return _fromPg(err);
  }

  static fromSqlite(err: unknown): FileSystemError {
    return _fromSqlite(err);
  }
}

// Imported here as bindings (not values) so the static methods above
// can resolve them lazily. The actual implementation lives in mappers.ts.
import { fromAws as _fromAws, fromPg as _fromPg, fromSqlite as _fromSqlite } from "./mappers";
export { fromAws, fromPg, fromSqlite } from "./mappers";
