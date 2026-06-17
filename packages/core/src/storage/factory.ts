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
 *   - a real `forTenant` chain (PR 3) that builds a chainable
 *     `TenantScope` and materializes into a namespaced FileSystem
 *     via `.bucket().prefix().fs()`
 *
 * Validation contract: the factory re-runs `parseFileSystemConfig`
 * on its input and **throws** (not returns) a `FileSystemError` on
 * invalid input. The env-singleton (T-011) is the layer that
 * converts a thrown error into a startup failure; the factory
 * itself trusts the input type and only validates as a defensive
 * net.
 */
import type { S3Client } from "@aws-sdk/client-s3";
import { FileSystemError } from "@/errors";
import { createS3Adapter, createS3Client } from "./s3-adapter";
import { parseFileSystemConfig, type FileSystemConfig } from "./config";
import type { FileSystem } from "./filesystem";
import type { S3CompatibleAdapter } from "./adapter";
import { forTenant, TenantScope } from "./tenant-scope";

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

  const client: S3Client = createS3Client(parsed.value);
  const adapter: S3CompatibleAdapter = createS3Adapter(client, parsed.value);

  // PR 3: real chainable forTenant. Each call returns a new
  // TenantScope; calling .fs() materializes a namespaced
  // FileSystem (own adapter, own config).
  const fs: FileSystem = {
    adapter,
    config: parsed.value,
    metadata: undefined,
    forTenant: (tenantId: string): TenantScope => forTenant(tenantId, fs),
  };
  return fs;
};

// Re-exports for tests and downstream consumers
export { forTenant, TenantScope, withPrefixAdapter } from "./tenant-scope";
export type { RequestContext } from "./auth";
export { withAuth } from "./auth";
export type { AuthContext } from "./auth-types";
