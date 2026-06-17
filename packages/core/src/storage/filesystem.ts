/**
 * The `FileSystem` container — the public surface a consumer
 * programs against.
 *
 * It is intentionally a thin aggregator: a single adapter (the
 * actual storage client) + the immutable config that produced it +
 * an optional secondary metadata index + a `forTenant` chain that
 * returns a `TenantScope` (chainable into `.bucket().prefix().fs()`).
 *
 * The `forTenant` method returns a `TenantScope`, not a FileSystem,
 * because consumers almost always want to chain scoping options
 * (`.bucket()`, `.prefix()`) before materializing. A consumer who
 * wants the FileSystem directly can call `fs.forTenant(id).fs()`.
 */
import type { TenantScope } from "./tenant-scope";
import type { S3CompatibleAdapter } from "./adapter";
import type { FileSystemConfig } from "./config";
import type { MetadataStore } from "../metadata/store";

export interface FileSystem {
  readonly adapter: S3CompatibleAdapter;
  readonly config: FileSystemConfig;
  readonly metadata: MetadataStore | undefined;
  forTenant(tenantId: string): TenantScope;
}
