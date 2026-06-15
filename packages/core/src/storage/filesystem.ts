/**
 * The `FileSystem` container — the public surface a consumer
 * programs against.
 *
 * It is intentionally a thin aggregator: a single adapter (the
 * actual storage client) + the immutable config that produced it +
 * an optional secondary metadata index + a `forTenant` chain that
 * returns a namespaced view.
 *
 * Defined in T-012 (the interface task) so that downstream tasks
 * (T-010 factory, T-011 singleton) can return it without a circular
 * type reference. The `forTenant` implementation lands in PR 3.
 */
import type { S3CompatibleAdapter } from "./adapter";
import type { FileSystemConfig } from "./config";
import type { MetadataStore } from "../metadata/store";

export interface FileSystem {
  readonly adapter: S3CompatibleAdapter;
  readonly config: FileSystemConfig;
  readonly metadata: MetadataStore | undefined;
  forTenant(tenantId: string): FileSystem;
}
