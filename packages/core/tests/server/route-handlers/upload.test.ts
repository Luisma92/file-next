/**
 * Tests for `createUploadRouteHandler`.
 *
 * The route handler factory is the chokepoint that:
 *   - validates `maxBytes` (413 PayloadTooLarge) and
 *     `allowedContentTypes` (415 UnsupportedMediaType) BEFORE
 *     calling the presigned-URL adapter (so no URL is signed
 *     on a rejected request);
 *   - caps `expiresIn` at factory construction time (S3 SigV4 7d
 *     limit, per decision `expiresin-cap-timing`).
 *
 * Mocking strategy: `getSignedUrl` from `@aws-sdk/s3-request-presigner`
 * is mocked at the module level. The function only signs locally
 * (it does NOT call S3), so the mock just returns a controlled URL.
 * The real `createPresignedUploadUrl` adapter runs to exercise the
 * full route-handler → adapter → presigner chain end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";

// Module-level mock: getSignedUrl only signs locally, no S3 calls.
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(),
}));

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createUploadRouteHandler } from "@/server/route-handlers/upload";
import { createPresignedUploadUrl } from "@/storage/s3-adapter/presigned";
import { FileSystemError } from "@/errors";
import type { FileSystem } from "@/storage/filesystem";
import type { FileSystemConfig } from "@/storage/config";
import type { PresignedUploadInput, PresignedDownloadInput } from "@/storage/adapter";

const config: FileSystemConfig = {
  provider: "s3",
  bucket: "test-bucket",
  region: "us-east-1",
  credentials: { accessKeyId: "AKIA-TEST", secretAccessKey: "test-secret" },
  forcePathStyle: false,
};

const client = new S3Client({ region: "us-east-1" });

/**
 * Build a `FileSystem` whose `adapter.createPresignedUploadUrl` is
 * the real implementation (delegating to the mocked `getSignedUrl`).
 * Other adapter methods are stubbed — the upload route handler only
 * calls `createPresignedUploadUrl`.
 */
const makeFs = (): FileSystem =>
  ({
    adapter: {
      createPresignedUploadUrl: (input: PresignedUploadInput) => createPresignedUploadUrl(client, config, input),
    } as never,
    config,
    metadata: undefined,
    forTenant: () => {
      throw new Error("not used");
    },
  }) as FileSystem;

const makeUploadRequest = (body: Record<string, unknown>) =>
  new Request("https://example.com/api/upload?key=" + encodeURIComponent(String(body.key ?? "")), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.mocked(getSignedUrl).mockReset();
  vi.mocked(getSignedUrl).mockResolvedValue(
    "https://test-bucket.s3.us-east-1.amazonaws.com/uploads/x.txt?X-Amz-Expires=900&X-Amz-Signature=mock",
  );
});

describe("T-049: createUploadRouteHandler — request-time validation", () => {
  it("returns 413 PayloadTooLarge when contentLength exceeds maxBytes (no URL signed)", async () => {
    const fs = makeFs();
    const handler = createUploadRouteHandler({ fs, maxBytes: 10_000_000 });
    const req = makeUploadRequest({ key: "uploads/big.bin", contentType: "image/png", contentLength: 20_000_000 });
    const res = await handler(req);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("PayloadTooLarge");
    // Critical: no presigned URL was signed
    expect(vi.mocked(getSignedUrl)).not.toHaveBeenCalled();
  });

  it("returns 415 UnsupportedMediaType when contentType is not in allowedContentTypes", async () => {
    const fs = makeFs();
    const handler = createUploadRouteHandler({
      fs,
      allowedContentTypes: ["image/png", "image/jpeg"],
    });
    const req = makeUploadRequest({ key: "uploads/x.zip", contentType: "application/zip", contentLength: 1024 });
    const res = await handler(req);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UnsupportedMediaType");
    expect(vi.mocked(getSignedUrl)).not.toHaveBeenCalled();
  });

  it("supports wildcard content-type patterns (image/*)", async () => {
    const fs = makeFs();
    const handler = createUploadRouteHandler({
      fs,
      allowedContentTypes: ["image/*"],
    });
    const req = makeUploadRequest({ key: "uploads/cat.png", contentType: "image/png", contentLength: 1024 });
    const res = await handler(req);
    expect(res.status).toBe(200);
  });

  it("happy path: returns 200 with { url, key, expiresAt }", async () => {
    const fs = makeFs();
    const handler = createUploadRouteHandler({ fs });
    const before = Date.now();
    const req = makeUploadRequest({ key: "uploads/x.txt", contentType: "text/plain", contentLength: 1024 });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.value.url).toMatch(/X-Amz-Expires=900/);
    expect(body.value.key).toBe("uploads/x.txt");
    // expiresAt is roughly now + 900s (default)
    const expiresAt = new Date(body.value.expiresAt).getTime();
    expect(Math.abs(expiresAt - (before + 900 * 1000))).toBeLessThan(5000);
  });

  it("calls getSignedUrl with a PutObjectCommand targeting the right bucket + key + expiresIn", async () => {
    const fs = makeFs();
    const handler = createUploadRouteHandler({ fs, expiresIn: 600 });
    const req = makeUploadRequest({ key: "uploads/photo.jpg", contentType: "image/jpeg", contentLength: 2048 });
    await handler(req);
    expect(vi.mocked(getSignedUrl)).toHaveBeenCalledTimes(1);
    const [clientArg, cmdArg, optsArg] = vi.mocked(getSignedUrl).mock.calls[0]!;
    expect(clientArg).toBeDefined();
    // The second arg is a PutObjectCommand instance
    expect((cmdArg as { constructor: { name: string } }).constructor.name).toBe("PutObjectCommand");
    expect((cmdArg as { input: { Bucket: string; Key: string; ContentType: string } }).input.Bucket).toBe("test-bucket");
    expect((cmdArg as { input: { Bucket: string; Key: string; ContentType: string } }).input.Key).toBe("uploads/photo.jpg");
    expect((cmdArg as { input: { Bucket: string; Key: string; ContentType: string } }).input.ContentType).toBe("image/jpeg");
    expect((optsArg as { expiresIn: number }).expiresIn).toBe(600);
  });
});

describe("T-049: createUploadRouteHandler — construction-time expiresIn cap", () => {
  it("throws FileSystemError SYNCHRONOUSLY when expiresIn > 7 days (S3 SigV4 limit)", () => {
    const fs = makeFs();
    expect(() =>
      createUploadRouteHandler({ fs, expiresIn: 30 * 86400 }),
    ).toThrow(FileSystemError);
    // The catalog is closed at 11 codes; the specific reason is on cause.code.
    try {
      createUploadRouteHandler({ fs, expiresIn: 30 * 86400 });
    } catch (e) {
      expect(e).toBeInstanceOf(FileSystemError);
      const err = e as FileSystemError;
      expect(err.cause?.code).toBe("InvalidArgument");
      expect(err.retryable).toBe(false);
    }
  });

  it("throws when expiresIn is at the boundary (7d + 1 second)", () => {
    const fs = makeFs();
    expect(() => createUploadRouteHandler({ fs, expiresIn: 7 * 86400 + 1 })).toThrow(FileSystemError);
  });

  it("accepts expiresIn at exactly 7 days (S3 SigV4 cap)", () => {
    const fs = makeFs();
    expect(() => createUploadRouteHandler({ fs, expiresIn: 7 * 86400 })).not.toThrow();
  });

  it("throws when expiresIn is 0 or negative", () => {
    const fs = makeFs();
    expect(() => createUploadRouteHandler({ fs, expiresIn: 0 })).toThrow(FileSystemError);
    expect(() => createUploadRouteHandler({ fs, expiresIn: -1 })).toThrow(FileSystemError);
  });

  it("defaults expiresIn to 900s when omitted", async () => {
    const fs = makeFs();
    const handler = createUploadRouteHandler({ fs });
    const req = makeUploadRequest({ key: "uploads/x.txt", contentType: "text/plain", contentLength: 1024 });
    await handler(req);
    const optsArg = vi.mocked(getSignedUrl).mock.calls[0]![2] as { expiresIn: number };
    expect(optsArg.expiresIn).toBe(900);
  });
});
