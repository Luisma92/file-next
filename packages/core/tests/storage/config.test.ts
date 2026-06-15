/**
 * T-009: `FileSystemConfig` — the discriminated union of provider
 * configs (S3 / R2) and its Zod-driven parser.
 *
 * The parser is the single trust boundary for env-derived storage
 * configuration. Every downstream consumer (`createFileSystem`,
 * `getFileSystem`, the concrete S3 / R2 adapters) MUST go through
 * `parseFileSystemConfig` before touching the network. The Zod
 * schema doubles as a runtime guard AND the source of the TS type
 * (`z.infer<...>`), so the wire shape and the type can never drift.
 *
 * The shape is a discriminated union on `provider`:
 *   - `s3`: bucket + region + credentials; endpoint & forcePathStyle optional
 *   - `r2`: bucket + endpoint + credentials; forcePathStyle is
 *           ALWAYS true (R2 requires path-style addressing)
 *
 * ZodError from a failed parse is wrapped in a `FileSystemError`
 * with code `InternalError` and the original issues preserved on
 * `cause.issues` so the env-singleton (T-011) can surface a useful
 * startup error.
 */
import { describe, it, expect } from "vitest";
import {
  parseFileSystemConfig,
  type FileSystemConfig,
} from "@/storage/config";
import { FileSystemError } from "@/errors";

const validS3 = {
  provider: "s3",
  bucket: "my-bucket",
  region: "us-east-1",
  credentials: {
    accessKeyId: "AKIA",
    secretAccessKey: "secret",
  },
};

const validR2 = {
  provider: "r2",
  bucket: "my-bucket",
  endpoint: "https://account.r2.cloudflarestorage.com",
  credentials: {
    accessKeyId: "AKIA",
    secretAccessKey: "secret",
  },
  forcePathStyle: true,
};

describe("T-009: FileSystemConfig + parseFileSystemConfig", () => {
  describe("valid configs parse", () => {
    it("accepts a minimal valid s3 config", () => {
      const result = parseFileSystemConfig(validS3);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.provider).toBe("s3");
      }
    });

    it("accepts a minimal valid r2 config", () => {
      const result = parseFileSystemConfig(validR2);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.provider).toBe("r2");
      }
    });

    it("s3 accepts forcePathStyle=true", () => {
      const result = parseFileSystemConfig({
        ...validS3,
        forcePathStyle: true,
      });
      expect(result.ok).toBe(true);
    });

    it("s3 accepts an optional endpoint (for S3-compatible providers)", () => {
      const result = parseFileSystemConfig({
        ...validS3,
        endpoint: "https://minio.local",
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("invalid configs fail", () => {
    it("r2 requires an endpoint", () => {
      const { endpoint: _endpoint, ...r2NoEndpoint } = validR2;
      void _endpoint;
      const result = parseFileSystemConfig(r2NoEndpoint);
      expect(result.ok).toBe(false);
    });

    it("r2 rejects forcePathStyle=false (must be literal true)", () => {
      const result = parseFileSystemConfig({
        ...validR2,
        forcePathStyle: false,
      });
      expect(result.ok).toBe(false);
    });

    it("s3 requires region", () => {
      const { region: _region, ...s3NoRegion } = validS3;
      void _region;
      const result = parseFileSystemConfig(s3NoRegion);
      expect(result.ok).toBe(false);
    });

    it("missing credentials fails", () => {
      const { credentials: _credentials, ...s3NoCreds } = validS3;
      void _credentials;
      const result = parseFileSystemConfig(s3NoCreds);
      expect(result.ok).toBe(false);
    });

    it("empty accessKeyId fails", () => {
      const result = parseFileSystemConfig({
        ...validS3,
        credentials: { accessKeyId: "", secretAccessKey: "secret" },
      });
      expect(result.ok).toBe(false);
    });

    it("unknown provider fails", () => {
      const result = parseFileSystemConfig({
        ...validS3,
        provider: "backblaze",
      });
      expect(result.ok).toBe(false);
    });

    it("non-object input fails", () => {
      expect(parseFileSystemConfig("nope").ok).toBe(false);
      expect(parseFileSystemConfig(42).ok).toBe(false);
      expect(parseFileSystemConfig(null).ok).toBe(false);
    });
  });

  describe("error mapping", () => {
    it("invalid input wraps ZodError as FileSystemError(InternalError)", () => {
      const result = parseFileSystemConfig({ provider: "nope" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(FileSystemError);
        expect(result.error.code).toBe("InternalError");
        expect(result.error.retryable).toBe(false);
        // Zod issues are preserved on cause for debugging
        expect(result.error.cause).toBeDefined();
        expect(result.error.cause?.code).toBe("ZodError");
      }
    });
  });

  describe("type inference", () => {
    it("FileSystemConfig is a discriminated union on provider", () => {
      const s3: FileSystemConfig = {
        provider: "s3",
        bucket: "b",
        region: "us-east-1",
        credentials: { accessKeyId: "a", secretAccessKey: "s" },
        forcePathStyle: false,
      };
      const r2: FileSystemConfig = {
        provider: "r2",
        bucket: "b",
        endpoint: "https://e",
        credentials: { accessKeyId: "a", secretAccessKey: "s" },
        forcePathStyle: true,
      };
      // Compile-time narrowing: provider is "s3" | "r2"
      const label = (c: FileSystemConfig): string =>
        c.provider === "s3" ? "s3" : "r2";
      expect(label(s3)).toBe("s3");
      expect(label(r2)).toBe("r2");
    });
  });
});
