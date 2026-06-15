/**
 * Placeholder `FileSystemError` used by `Result`'s default error
 * parameter. T-007a replaces this file with the full class
 * (11 codes) and T-007b adds the upstream mappers
 * (fromAws / fromPg / fromSqlite). The shape below is the MINIMUM
 * the result.ts tests need today.
 */

export type FileSystemErrorCode = string;

export interface FileSystemErrorOptions {
  code: FileSystemErrorCode;
  message: string;
  retryable: boolean;
  cause?: { code: string; message: string; [k: string]: unknown };
}

export class FileSystemError extends Error {
  readonly code: FileSystemErrorCode;
  readonly retryable: boolean;
  readonly cause?: { code: string; message: string; [k: string]: unknown };

  constructor(opts: FileSystemErrorOptions) {
    super(opts.message);
    this.name = "FileSystemError";
    this.code = opts.code;
    this.retryable = opts.retryable;
    if (opts.cause) {
      this.cause = opts.cause;
    }
  }

  /**
   * Stable JSON shape for RSC pass-through. Error.prototype.message
   * is non-enumerable, so plain `JSON.stringify(err)` would emit `{}`
   * and lose the message + code + retryable flag.
   */
  toJSON(): {
    name: string;
    code: FileSystemErrorCode;
    message: string;
    retryable: boolean;
    cause?: { code: string; message: string; [k: string]: unknown };
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.cause !== undefined ? { cause: this.cause } : {}),
    };
  }
}
