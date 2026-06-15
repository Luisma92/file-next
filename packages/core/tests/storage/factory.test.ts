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

  describe("stub adapter (PR 2a placeholder)", () => {
    it("every method returns Result.err(InternalError) 'not implemented'", async () => {
      const fs = createFileSystem(validS3);
      const calls: Array<Promise<{ ok: boolean; error?: unknown }>> = [
        fs.adapter.list({ prefix: "" as never }),
        fs.adapter.read({ key: "a" as never }),
        fs.adapter.write({ key: "a" as never, body: new Uint8Array() }),
        fs.adapter.delete({ key: "a" as never }),
        fs.adapter.move({ sourceKey: "a" as never, destinationKey: "b" as never }),
        fs.adapter.copy({ sourceKey: "a" as never, destinationKey: "b" as never }),
        fs.adapter.stat({ key: "a" as never }),
        fs.adapter.exists({ key: "a" as never }),
        fs.adapter.getMetadata({ key: "a" as never }),
        fs.adapter.setMetadata({ key: "a" as never, metadata: {} }),
        fs.adapter.createPresignedUploadUrl({ key: "a" as never }),
        fs.adapter.createPresignedDownloadUrl({ key: "a" as never }),
        fs.adapter.getPublicUrl({ key: "a" as never }),
      ];
      const results = await Promise.all(calls);
      expect(results).toHaveLength(13);
      for (const r of results) {
        expect(r.ok).toBe(false);
        if (!r.ok && r.error instanceof FileSystemError) {
          expect(r.error.code).toBe("InternalError");
          expect(r.error.retryable).toBe(false);
          expect(r.error.message).toContain("not implemented");
        }
      }
    });
  });

  describe("forTenant (PR 2a no-op)", () => {
    it("forTenant returns another FileSystem (shape only, no namespace logic yet)", () => {
      const fs = createFileSystem(validS3);
      const child = fs.forTenant("tenant-1");
      expectTypeOf(child).toMatchTypeOf<FileSystem>();
    });
  });
});
