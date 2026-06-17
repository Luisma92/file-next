/**
 * `forTenant` — the chainable, immutable per-tenant scope.
 *
 * Replaces the PR 2a no-op builder. Two scoping strategies are
 * supported, both independent:
 *
 *   - **bucket override** (`.bucket(name)`): swap the entire bucket
 *     for this tenant. Common in R2 setups where each tenant has
 *     their own account.
 *   - **prefix override** (`.prefix("/org/acme")`): keep the same
 *     bucket but namespace all keys under a POSIX prefix. Common
 *     in S3 setups with one shared bucket.
 *
 * The builder is immutable: every call returns a NEW scope, so
 * chains can be safely shared across requests without leakage.
 * The materialized FileSystem owns its own adapter (wrapped via
 * `withPrefixAdapter`) so the parent FileSystem is not mutated.
 *
 * Materialization happens at `.fs()`. The returned FileSystem
 * has:
 *   - the same client (R2/S3 endpoint lives at the client level)
 *   - the rewritten config (bucket override applied, if any)
 *   - an adapter that rewrites every key through the prefix
 *   - a `forTenant` that can chain further (nested tenant scopes
 *     land in v0.2 — for v0.1, calling `forTenant` on a child
 *     scope resets to a new tenantId)
 */
import type { S3Client } from "@aws-sdk/client-s3";
import type { S3CompatibleAdapter } from "./adapter";
import { asPrefix, asS3Key, type Prefix, type S3Key } from "@/types/branded";
import { createS3Adapter, createS3Client } from "./s3-adapter";
import { parseFileSystemConfig } from "./config";
import type { FileSystem } from "./filesystem";
import type { FileSystemConfig } from "./config";

/**
 * An adapter wrapper that rewrites every key through a POSIX
 * prefix. The prefix is applied to:
 *   - the `key` field on read/write/delete/move/copy/stat/
 *     exists/getMetadata/setMetadata
 *   - the `sourceKey` and `destinationKey` on move/copy
 *   - the `prefix` on list (re-prepended)
 *   - the `key` on createPresignedUploadUrl /
 *     createPresignedDownloadUrl / getPublicUrl
 *
 * Empty prefix is a no-op (the original adapter is returned).
 * The wrapper preserves the `Result<T, FileSystemError>` shape
 * so error mapping flows through unchanged.
 */
export const withPrefixAdapter = (
  adapter: S3CompatibleAdapter,
  prefix: string,
): S3CompatibleAdapter => {
  if (!prefix) return adapter;

  // Strip trailing slash from the prefix; we always re-add it
  // when concatenating so a prefix of "/x" and a key of "a.txt"
  // become "/x/a.txt" (never "//a.txt" or "/xa.txt").
  const normalized = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const prepend = (key: string): string => `${normalized}/${key}`;

  return {
    list: (input) =>
      adapter.list({
        ...input,
        prefix: input.prefix
          ? asPrefix(prepend(input.prefix))
          : asPrefix(`${normalized}/`),
      }),
    read: (input) => adapter.read({ ...input, key: asS3Key(prepend(input.key)) }),
    write: (input) => adapter.write({ ...input, key: asS3Key(prepend(input.key)) }),
    delete: (input) => adapter.delete({ ...input, key: asS3Key(prepend(input.key)) }),
    move: (input) =>
      adapter.move({
        sourceKey: asS3Key(prepend(input.sourceKey)),
        destinationKey: asS3Key(prepend(input.destinationKey)),
      }),
    copy: (input) =>
      adapter.copy({
        sourceKey: asS3Key(prepend(input.sourceKey)),
        destinationKey: asS3Key(prepend(input.destinationKey)),
      }),
    stat: (input) => adapter.stat({ ...input, key: asS3Key(prepend(input.key)) }),
    exists: (input) => adapter.exists({ ...input, key: asS3Key(prepend(input.key)) }),
    getMetadata: (input) => adapter.getMetadata({ ...input, key: asS3Key(prepend(input.key)) }),
    setMetadata: (input) => adapter.setMetadata({ ...input, key: asS3Key(prepend(input.key)) }),
    createPresignedUploadUrl: (input) =>
      adapter.createPresignedUploadUrl({ ...input, key: asS3Key(prepend(input.key)) }),
    createPresignedDownloadUrl: (input) =>
      adapter.createPresignedDownloadUrl({ ...input, key: asS3Key(prepend(input.key)) }),
    getPublicUrl: (input) => adapter.getPublicUrl({ ...input, key: asS3Key(prepend(input.key)) }),
  };
};

/**
 * TenantScope — the immutable builder returned by `forTenant`.
 *
 * Each chain method returns a new TenantScope; the underlying
 * FileSystem is NOT mutated. `fs()` materializes the scope into
 * a fresh FileSystem with the rewritten config + a prefix-wrapped
 * adapter.
 */
export class TenantScope {
  private constructor(
    public readonly tenantId: string,
    public readonly parent: FileSystem,
    public readonly bucketOverride: string | undefined,
    public readonly prefixOverride: string | undefined,
  ) {
    Object.freeze(this);
  }

  /** Start a new scope from a parent FileSystem. */
  static start(tenantId: string, parent: FileSystem): TenantScope {
    return new TenantScope(tenantId, parent, undefined, undefined);
  }

  /** Swap the entire bucket for this tenant. */
  bucket(name: string): TenantScope {
    return new TenantScope(this.tenantId, this.parent, name, this.prefixOverride);
  }

  /** Namespace all keys under a POSIX prefix. */
  prefix(value: Prefix | string): TenantScope {
    const p = typeof value === "string" ? asPrefix(value) : value;
    return new TenantScope(this.tenantId, this.parent, this.bucketOverride, p);
  }

  /**
   * Materialize the scope into a fresh FileSystem. The result is
   * fully self-contained: it owns its own adapter (with the prefix
   * wrapper applied) and its own parsed config (with the bucket
   * override applied).
   */
  fs(): FileSystem {
    const parsed = parseFileSystemConfig(this.parent.config);
    if (!parsed.ok) {
      // Defensive: the parent FileSystem already parsed this, so
      // the result should always be ok. If it isn't, surface as
      // a typed error rather than throw at runtime.
      throw new Error(`TenantScope: parent config is invalid: ${parsed.error.message}`);
    }
    const baseConfig: FileSystemConfig = parsed.value;
    const nextConfig: FileSystemConfig = {
      ...baseConfig,
      ...(this.bucketOverride !== undefined ? { bucket: this.bucketOverride } : {}),
    };
    const client: S3Client = createS3Client(nextConfig);
    const baseAdapter: S3CompatibleAdapter = createS3Adapter(client, nextConfig);
    const adapter: S3CompatibleAdapter = this.prefixOverride
      ? withPrefixAdapter(baseAdapter, this.prefixOverride)
      : baseAdapter;

    const child: FileSystem = {
      adapter,
      config: nextConfig,
      metadata: this.parent.metadata,
      forTenant: (id: string) => TenantScope.start(id, child),
    };
    return child;
  }
}

/**
 * `forTenant` — the public entry point on every `FileSystem`.
 * Returns a chainable TenantScope; call `.bucket()`, `.prefix()`,
 * and `.fs()` to materialize.
 *
 * Usage:
 *   const tenantFs = fs.forTenant("acme-corp")
 *     .bucket("acme-private")          // per-tenant bucket (R2-style)
 *     .prefix("/org/acme")             // POSIX prefix (S3-style)
 *     .fs();
 */
export const forTenant = (tenantId: string, parent: FileSystem): TenantScope =>
  TenantScope.start(tenantId, parent);
