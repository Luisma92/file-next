/**
 * `getFileSystem()` — the env-driven singleton that returns a
 * memoized `FileSystem` for the lifetime of the Node process.
 *
 * Usage:
 *   - Server-side code (route handlers, server actions) imports
 *     `getFileSystem` and calls it; the first call reads
 *     `FILE_NEXT_*` env vars, parses them, and caches the result.
 *   - Subsequent calls return the same instance — no per-request
 *     re-parsing, no accidental config drift.
 *
 * Env vars (all `FILE_NEXT_` prefixed):
 *   - FILE_NEXT_PROVIDER          (required, "s3" | "r2")
 *   - FILE_NEXT_BUCKET            (required)
 *   - FILE_NEXT_REGION            (required for s3)
 *   - FILE_NEXT_ENDPOINT          (required for r2)
 *   - FILE_NEXT_ACCESS_KEY_ID     (required)
 *   - FILE_NEXT_SECRET_ACCESS_KEY (required)
 *   - FILE_NEXT_FORCE_PATH_STYLE  (optional, default "false")
 *
 * Failure mode: a missing or malformed env throws
 * `FileSystemError(InternalError, retryable: false)` with the
 * original Zod issues on `cause`. This is a startup-time failure
 * (the process cannot function without a storage backend), so
 * throwing is the right contract — the caller (server bootstrap)
 * fails the process and the operator sees the issue in the logs.
 *
 * Test escape hatch: `_resetFileSystemForTests` clears the
 * memoized instance. The naming is intentionally ugly so a casual
 * reader can tell it should never be called from production code.
 */
import { createFileSystem } from "./factory";
import { parseFileSystemConfig, type FileSystemConfig } from "./config";
import { FileSystemError } from "@/errors";
import type { FileSystem } from "./filesystem";

/** Cached FileSystem instance (null until first call). */
let cached: FileSystem | null = null;

/**
 * Read `FILE_NEXT_*` env vars and return a typed `FileSystemConfig`
 * object. Throws `FileSystemError(InternalError)` on missing or
 * malformed env, with the original Zod issues on `cause`.
 */
const readConfigFromEnv = (): FileSystemConfig => {
  const provider = process.env.FILE_NEXT_PROVIDER;
  const bucket = process.env.FILE_NEXT_BUCKET;
  const region = process.env.FILE_NEXT_REGION;
  const endpoint = process.env.FILE_NEXT_ENDPOINT;
  const accessKeyId = process.env.FILE_NEXT_ACCESS_KEY_ID;
  const secretAccessKey = process.env.FILE_NEXT_SECRET_ACCESS_KEY;
  const forcePathStyleRaw = process.env.FILE_NEXT_FORCE_PATH_STYLE;

  // Build a draft object that the Zod schema can validate. Provider-
  // specific required fields (region for s3, endpoint for r2) are
  // surfaced as parse errors if missing, so we don't need to branch
  // here.
  const draft: Record<string, unknown> = {
    provider,
    bucket,
    region,
    endpoint,
    credentials:
      accessKeyId !== undefined && secretAccessKey !== undefined
        ? { accessKeyId, secretAccessKey }
        : undefined,
  };
  // R2 always uses path-style addressing (the Zod schema enforces
  // `forcePathStyle: literal(true)` for the r2 branch), so seed it
  // unconditionally. S3 honors the env var; default false.
  if (provider === "r2") {
    draft.forcePathStyle = true;
  } else if (forcePathStyleRaw !== undefined) {
    draft.forcePathStyle = forcePathStyleRaw === "true";
  }

  const parsed = parseFileSystemConfig(draft);
  if (!parsed.ok) {
    // Wrap the Zod error in a "not configured" InternalError so the
    // message reads as a startup failure, not a malformed-shape
    // failure. The original issues stay on `cause` for debugging.
    throw new FileSystemError({
      code: "InternalError",
      message: "file-next storage is not configured: missing or invalid FILE_NEXT_* env vars",
      retryable: false,
      cause: parsed.error.cause,
    });
  }
  return parsed.value;
};

/**
 * Return the memoized `FileSystem` for the current process, building
 * it from `FILE_NEXT_*` env vars on first call.
 */
export const getFileSystem = (): FileSystem => {
  if (cached !== null) return cached;
  const config = readConfigFromEnv();
  cached = createFileSystem(config);
  return cached;
};

/**
 * Test-only helper: clear the memoized `FileSystem` so the next
 * `getFileSystem()` call re-reads env vars. Production code MUST
 * NOT call this — the leading underscore is the contract.
 */
export const _resetFileSystemForTests = (): void => {
  cached = null;
};
