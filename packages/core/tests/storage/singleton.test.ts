/**
 * T-011: `getFileSystem()` — the env-driven singleton that returns
 * a memoized `FileSystem` for the lifetime of the Node process.
 *
 * The singleton is the runtime entry point for server-side code:
 *   - First call: reads `FILE_NEXT_*` env vars, parses them via
 *     `parseFileSystemConfig`, builds a `FileSystem` via
 *     `createFileSystem`, caches it in module scope.
 *   - Subsequent calls: return the cached instance.
 *
 * Tests need to clear the cache between runs (otherwise the second
 * test in a process would receive a leaked `FileSystem` from the
 * first). `_resetFileSystemForTests` is the explicit escape hatch:
 * its name is ugly on purpose so it can't be mistaken for a normal
 * API in production code.
 *
 * Env vars (all `FILE_NEXT_` prefixed):
 *   - FILE_NEXT_PROVIDER          (required, "s3" | "r2")
 *   - FILE_NEXT_BUCKET            (required)
 *   - FILE_NEXT_REGION            (required for s3)
 *   - FILE_NEXT_ENDPOINT          (required for r2)
 *   - FILE_NEXT_ACCESS_KEY_ID     (required)
 *   - FILE_NEXT_SECRET_ACCESS_KEY (required)
 *   - FILE_NEXT_FORCE_PATH_STYLE  (optional, default "false")
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getFileSystem,
  _resetFileSystemForTests,
} from "@/storage/singleton";
import { createFileSystem } from "@/storage/factory";
import { FileSystemError } from "@/errors";

const ENV_KEYS = [
  "FILE_NEXT_PROVIDER",
  "FILE_NEXT_BUCKET",
  "FILE_NEXT_REGION",
  "FILE_NEXT_ENDPOINT",
  "FILE_NEXT_ACCESS_KEY_ID",
  "FILE_NEXT_SECRET_ACCESS_KEY",
  "FILE_NEXT_FORCE_PATH_STYLE",
] as const;

const clearEnv = (): void => {
  for (const k of ENV_KEYS) {
    delete process.env[k];
  }
};

const setS3Env = (overrides: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}): void => {
  clearEnv();
  process.env.FILE_NEXT_PROVIDER = overrides.FILE_NEXT_PROVIDER ?? "s3";
  process.env.FILE_NEXT_BUCKET = overrides.FILE_NEXT_BUCKET ?? "my-bucket";
  process.env.FILE_NEXT_REGION = overrides.FILE_NEXT_REGION ?? "us-east-1";
  process.env.FILE_NEXT_ACCESS_KEY_ID = overrides.FILE_NEXT_ACCESS_KEY_ID ?? "AKIA";
  process.env.FILE_NEXT_SECRET_ACCESS_KEY = overrides.FILE_NEXT_SECRET_ACCESS_KEY ?? "secret";
  if (overrides.FILE_NEXT_FORCE_PATH_STYLE !== undefined) {
    process.env.FILE_NEXT_FORCE_PATH_STYLE = overrides.FILE_NEXT_FORCE_PATH_STYLE;
  }
};

describe("T-011: getFileSystem (env singleton)", () => {
  beforeEach(() => {
    _resetFileSystemForTests();
    clearEnv();
  });

  afterEach(() => {
    clearEnv();
    _resetFileSystemForTests();
  });

  describe("happy path", () => {
    it("returns a FileSystem when all required env vars are set (s3)", () => {
      setS3Env();
      const fs = getFileSystem();
      expect(fs.config.provider).toBe("s3");
      if (fs.config.provider === "s3") {
        expect(fs.config.bucket).toBe("my-bucket");
        expect(fs.config.region).toBe("us-east-1");
      }
    });

    it("returns a FileSystem when all required env vars are set (r2)", () => {
      clearEnv();
      process.env.FILE_NEXT_PROVIDER = "r2";
      process.env.FILE_NEXT_BUCKET = "my-bucket";
      process.env.FILE_NEXT_ENDPOINT = "https://account.r2.cloudflarestorage.com";
      process.env.FILE_NEXT_ACCESS_KEY_ID = "AKIA";
      process.env.FILE_NEXT_SECRET_ACCESS_KEY = "secret";
      const fs = getFileSystem();
      expect(fs.config.provider).toBe("r2");
      expect(fs.config.forcePathStyle).toBe(true);
    });

    it("env-driven config matches what the factory would produce from the same vars", () => {
      setS3Env();
      const singletonFs = getFileSystem();
      const factoryFs = createFileSystem(singletonFs.config);
      expect(factoryFs.config).toEqual(singletonFs.config);
    });
  });

  describe("missing env vars", () => {
    it("throws FileSystemError when FILE_NEXT_PROVIDER is missing", () => {
      setS3Env();
      delete process.env.FILE_NEXT_PROVIDER;
      expect(() => getFileSystem()).toThrow(FileSystemError);
    });

    it("throws FileSystemError when FILE_NEXT_BUCKET is missing", () => {
      setS3Env();
      delete process.env.FILE_NEXT_BUCKET;
      expect(() => getFileSystem()).toThrow(FileSystemError);
    });

    it("throws FileSystemError when FILE_NEXT_REGION is missing for s3", () => {
      setS3Env();
      delete process.env.FILE_NEXT_REGION;
      expect(() => getFileSystem()).toThrow(FileSystemError);
    });

    it("throws FileSystemError when FILE_NEXT_ENDPOINT is missing for r2", () => {
      clearEnv();
      process.env.FILE_NEXT_PROVIDER = "r2";
      process.env.FILE_NEXT_BUCKET = "b";
      process.env.FILE_NEXT_ACCESS_KEY_ID = "a";
      process.env.FILE_NEXT_SECRET_ACCESS_KEY = "s";
      // no FILE_NEXT_ENDPOINT
      expect(() => getFileSystem()).toThrow(FileSystemError);
    });

    it("thrown error is InternalError, not retryable, with Zod issues on cause", () => {
      clearEnv();
      try {
        getFileSystem();
        expect.fail("expected getFileSystem to throw");
      } catch (e) {
        expect(e).toBeInstanceOf(FileSystemError);
        if (e instanceof FileSystemError) {
          expect(e.code).toBe("InternalError");
          expect(e.retryable).toBe(false);
          expect(e.cause).toBeDefined();
          expect(e.cause?.code).toBe("ZodError");
        }
      }
    });
  });

  describe("memoization", () => {
    it("returns the same FileSystem instance on repeated calls", () => {
      setS3Env();
      const a = getFileSystem();
      const b = getFileSystem();
      expect(a).toBe(b);
    });

    it("returns a new instance after _resetFileSystemForTests", () => {
      setS3Env();
      const a = getFileSystem();
      _resetFileSystemForTests();
      const b = getFileSystem();
      expect(a).not.toBe(b);
      expect(a.config).toEqual(b.config);
    });
  });

  describe("FILE_NEXT_FORCE_PATH_STYLE", () => {
    it("defaults to false on s3 when unset", () => {
      setS3Env();
      delete process.env.FILE_NEXT_FORCE_PATH_STYLE;
      const fs = getFileSystem();
      expect(fs.config.provider).toBe("s3");
      if (fs.config.provider === "s3") {
        expect(fs.config.forcePathStyle).toBe(false);
      }
    });

    it("honors FILE_NEXT_FORCE_PATH_STYLE=true on s3", () => {
      setS3Env({ FILE_NEXT_FORCE_PATH_STYLE: "true" });
      const fs = getFileSystem();
      if (fs.config.provider === "s3") {
        expect(fs.config.forcePathStyle).toBe(true);
      }
    });
  });
});
