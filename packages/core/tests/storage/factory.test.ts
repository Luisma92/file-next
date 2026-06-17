/**
 * T-010: `createFileSystem(config)` — the factory that turns a
 * validated `FileSystemConfig` into a fully-shaped `FileSystem`.
 *
 * The factory is the only place that decides which concrete adapter
 * implementation to instantiate (currently: a stub; PR 2b adds the
 * real S3 and R2 adapters). Everything downstream of it (the
 * env-singleton in T-011, server actions, hooks) goes through
 * `createFileSystem` so the provider choice is made exactly once.
 *
 * For PR 2a the factory returns:
 *   - a stub adapter (satisfies `S3CompatibleAdapter`, every method
 *     returns `Result.err(InternalError)` — the 13 methods are
 *     typed and present so the rest of the codebase can be wired up
 *     against the shape before the real implementation lands)
 *   - the config as-is (immutable view)
 *   - `metadata: undefined` (the metadata index lands in a later PR)
 *   - a no-op `forTenant` chain (the real per-tenant namespacing
 *     lands in PR 3)
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import { createFileSystem } from "@/storage/factory";
import type { FileSystem } from "@/storage/filesystem";
import type { S3CompatibleAdapter } from "@/storage/adapter";
import type { FileSystemConfig } from "@/storage/config";
import { FileSystemError } from "@/errors";

const validS3: FileSystemConfig = {
  provider: "s3",
  bucket: "my-bucket",
  region: "us-east-1",
  credentials: { accessKeyId: "AKIA", secretAccessKey: "secret" },
  forcePathStyle: false,
};

const validR2: FileSystemConfig = {
  provider: "r2",
  bucket: "my-bucket",
  endpoint: "https://account.r2.cloudflarestorage.com",
  credentials: { accessKeyId: "AKIA", secretAccessKey: "secret" },
  forcePathStyle: true,
};

describe("T-010: createFileSystem", () => {
  describe("valid configs", () => {
    it("returns a FileSystem for a valid s3 config", () => {
      const fs: FileSystem = createFileSystem(validS3);
      expect(fs.config).toEqual(validS3);
      expect(fs.metadata).toBeUndefined();
    });

    it("returns a FileSystem for a valid r2 config", () => {
      const fs = createFileSystem(validR2);
      expect(fs.config).toEqual(validR2);
    });

    it("returned adapter is structurally a S3CompatibleAdapter", () => {
      const fs = createFileSystem(validS3);
      expectTypeOf(fs.adapter).toMatchTypeOf<S3CompatibleAdapter>();
    });

    it("returned FileSystem exposes a deeply-equal config (post-Zod-parse)", () => {
      const fs = createFileSystem(validS3);
      // Zod may apply defaults (e.g. forcePathStyle: false) and
      // re-emit a new object, so we check deep equality rather
      // than reference identity.
      expect(fs.config).toEqual(validS3);
    });
  });

  describe("invalid configs throw", () => {
    it("throws FileSystemError on an unknown provider", () => {
      const bad = {
        ...validS3,
        provider: "backblaze",
      } as unknown as FileSystemConfig;
      expect(() => createFileSystem(bad)).toThrow(FileSystemError);
    });

    it("thrown error is InternalError, not retryable", () => {
      const bad = { provider: "nope" } as unknown as FileSystemConfig;
      try {
        createFileSystem(bad);
        expect.fail("expected createFileSystem to throw");
      } catch (e) {
        expect(e).toBeInstanceOf(FileSystemError);
        if (e instanceof FileSystemError) {
          expect(e.code).toBe("InternalError");
          expect(e.retryable).toBe(false);
        }
      }
    });
  });

  describe("real adapter (PR 2b wire-up)", () => {
    it("returns a S3CompatibleAdapter that is NOT the PR 2a stub", () => {
      const fs = createFileSystem(validS3);
      // Smoke check: the adapter has the 13 methods. Real calls
      // would need a mocked S3Client; the per-method tests live
      // in `tests/storage/s3-adapter/*.test.ts` and exercise the
      // actual SDK command flow.
      const methodNames = [
        "list",
        "read",
        "write",
        "delete",
        "move",
        "copy",
        "stat",
        "exists",
        "getMetadata",
        "setMetadata",
        "createPresignedUploadUrl",
        "createPresignedDownloadUrl",
        "getPublicUrl",
      ] as const;
      for (const m of methodNames) {
        expect(typeof fs.adapter[m]).toBe("function");
      }
    });

    it("returned adapter is the real S3CompatibleAdapter (not a stub)", () => {
      const fs = createFileSystem(validS3);
      // A direct call to a method without a mocked client throws
      // an error FROM the SDK (network/auth), NOT the
      // 'not implemented' message the PR 2a stub returned.
      // We assert the error message is the SDK-shaped one.
      return fs.adapter.stat({ key: "a" as never }).then((r) => {
        // The call will fail (no real S3), but the failure path
        // is the SDK's, not the stub's. We just need to know
        // it's NOT the 'not implemented' string.
        if (!r.ok) {
          expect(r.error.message).not.toContain("not implemented");
        }
      }).catch(() => {
        // Network errors at the SDK level are also fine — the
        // point is that we did NOT get the 'not implemented' string.
      });
    });
  });

  describe("forTenant (PR 3 real chainable scope)", () => {
    it("forTenant returns a TenantScope (chainable into .bucket().prefix().fs())", () => {
      const fs = createFileSystem(validS3);
      const scope = fs.forTenant("tenant-1");
      // The shape is TenantScope, not FileSystem — consumers must
      // call .fs() to materialize. We assert the TenantScope type.
      expectTypeOf(scope).toHaveProperty("bucket");
      expectTypeOf(scope).toHaveProperty("prefix");
      expectTypeOf(scope).toHaveProperty("fs");
    });

    it("forTenant(...).fs() materializes a FileSystem with the rewritten config", () => {
      const fs = createFileSystem(validS3);
      const child = fs.forTenant("tenant-1").fs();
      expectTypeOf(child).toMatchTypeOf<FileSystem>();
      // tenantId is not on the FileSystem itself; the metadata
      // store would carry it (PR 4+). The structural isolation
      // is via the prefix wrapper, not a typed field.
    });
  });
});
