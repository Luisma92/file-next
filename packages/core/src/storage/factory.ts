/**
 * `createFileSystem(config)` — the factory that turns a validated
 * `FileSystemConfig` into a fully-shaped `FileSystem`.
 *
 * The factory is the only place that decides which concrete adapter
 * implementation to instantiate. Everything downstream of it (the
 * env-singleton in T-011, server actions, hooks) goes through
 * `createFileSystem` so the provider choice is made exactly once.
 *
 * As of PR 2b, the factory wires:
 *   - `createS3Client(config)` to produce the underlying S3Client
 *     (handles the S3 vs R2 endpoint + forcePathStyle + region knobs)
 *   - `createS3Adapter(client, config)` to produce the 13-method
 *     `S3CompatibleAdapter` (list/read/write/delete/move/copy/
 *     stat/exists/getMetadata/setMetadata/createPresignedUploadUrl/
 *     createPresignedDownloadUrl/getPublicUrl)
 *   - the config as-is (immutable view)
 *   - `metadata: undefined` (the metadata index lands in a later PR)
 *   - a no-op `forTenant` chain (the real per-tenant namespacing
 *     lands in PR 3)
 *
 * Validation contract: the factory re-runs `parseFileSystemConfig`
 * on its input and **throws** (not returns) a `FileSystemError` on
 * invalid input. The env-singleton (T-011) is the layer that
 * converts a thrown error into a startup failure; the factory
 * itself trusts the input type and only validates as a defensive
 * net.
 */
import type { Result } from "@/types/result";
import { FileSystemError } from "@/errors";
import { createS3Adapter, createS3Client } from "./s3-adapter";
import { parseFileSystemConfig, type FileSystemConfig } from "./config";
import type { FileSystem } from "./filesystem";
import type { S3CompatibleAdapter } from "./adapter";

/**
 * Build a `FileSystem` from a `FileSystemConfig`. Throws
 * `FileSystemError` (with `cause` carrying the Zod issues) if the
 * config is malformed.
 *
 * The throw (vs return) is deliberate: the env-singleton catches it
 * and fails the process; server-action callers can wrap in their
 * own try/catch where it matters.
 */
export const createFileSystem = (config: FileSystemConfig): FileSystem => {
  // Defensive parse: the type system already says config is
  // FileSystemConfig, but if a caller slips through a bad object
  // (e.g. from a JSON.parse of an env file) we want the failure to
  // surface as a typed FileSystemError, not a raw ZodError.
  const parsed = parseFileSystemConfig(config);
  if (!parsed.ok) {
    throw parsed.error;
  }

  const client = createS3Client(parsed.value);
  const adapter: S3CompatibleAdapter = createS3Adapter(client, parsed.value);

  // PR 2a: forTenant is a structural no-op. PR 3 replaces it with
  // a real per-tenant namespace (prefix rewriting + metadata
  // scoping). We close over `adapter` and the parsed config so the
  // returned child FileSystem is fully self-contained.
  const forTenant = (_tenantId: string): FileSystem => ({
    adapter,
    config: parsed.value,
    metadata: undefined,
    forTenant,
  });

  return {
    adapter,
    config: parsed.value,
    metadata: undefined,
    forTenant,
  };
};
