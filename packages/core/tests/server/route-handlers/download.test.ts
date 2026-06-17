/**
 * Tests for `createDownloadRouteHandler`.
 *
 * The download route handler signs a presigned GET URL the client
 * can use to read an object directly from the storage provider,
 * bypassing the Next.js server entirely.
 *
 * The body-validation surface is smaller than the upload handler
 * (no maxBytes / contentType to check), so the factory is
 * essentially: validate expiresIn at construction → wrap the
 * adapter's `createPresignedDownloadUrl` in a thin Response
 * envelope.
 *
 * Mocking: `getSignedUrl` is mocked at the module level (it only
 * signs locally, no S3 calls). The real `createPresignedDownloadUrl`
 * adapter runs to exercise the full chain.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(),
}));

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createDownloadRouteHandler } from "@/server/route-handlers/download";
import { createPresignedDownloadUrl } from "@/storage/s3-adapter/presigned";
import { FileSystemError } from "@/errors";
import type { FileSystem } from "@/storage/filesystem";
import type { FileSystemConfig } from "@/storage/config";

const config: FileSystemConfig = {
  provider: "s3",
  bucket: "test-bucket",
  region: "us-east-1",
  credentials: { accessKeyId: "AKIA-TEST", secretAccessKey: "test-secret" },
  forcePathStyle: false,
};

const client = new S3Client({ region: "us-east-1" });

const makeFs = (): FileSystem =>
  ({
    adapter: {
      createPresignedDownloadUrl: (input) => createPresignedDownloadUrl(client, config, input),
    } as never,
    config,
    metadata: undefined,
    forTenant: () => {
      throw new Error("not used");
    },
  }) as FileSystem;

const makeDownloadRequest = (key: string) =>
  new Request("https://example.com/api/download?key=" + encodeURIComponent(key), {
    method: "GET",
  });

beforeEach(() => {
  vi.mocked(getSignedUrl).mockReset();
  // Mimic a real S3 presigned GET URL with the default expiresIn baked in.
  vi.mocked(getSignedUrl).mockImplementation(async (_c, _cmd, opts) => {
    const expires = opts?.expiresIn ?? 900;
    return `https://test-bucket.s3.us-east-1.amazonaws.com/uploads/x.txt?X-Amz-Expires=${expires}&X-Amz-Signature=mock`;
  });
});

describe("T-050: createDownloadRouteHandler — happy path", () => {
  it("returns 200 with { url, expiresAt }", async () => {
    const fs = makeFs();
    const handler = createDownloadRouteHandler({ fs });
    const before = Date.now();
    const req = makeDownloadRequest("uploads/x.txt");
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.value.url).toMatch(/X-Amz-Expires=900/);
    // expiresAt is roughly now + 900s (default)
    const expiresAt = new Date(body.value.expiresAt).getTime();
    expect(Math.abs(expiresAt - (before + 900 * 1000))).toBeLessThan(5000);
  });

  it("calls getSignedUrl with a GetObjectCommand for the right key", async () => {
    const fs = makeFs();
    const handler = createDownloadRouteHandler({ fs, expiresIn: 3600 });
    const req = makeDownloadRequest("uploads/report.pdf");
    await handler(req);
    expect(vi.mocked(getSignedUrl)).toHaveBeenCalledTimes(1);
    const [_clientArg, cmdArg, optsArg] = vi.mocked(getSignedUrl).mock.calls[0]!;
    expect((cmdArg as { constructor: { name: string } }).constructor.name).toBe("GetObjectCommand");
    expect((cmdArg as { input: { Bucket: string; Key: string } }).input.Bucket).toBe("test-bucket");
    expect((cmdArg as { input: { Bucket: string; Key: string } }).input.Key).toBe("uploads/report.pdf");
    expect((optsArg as { expiresIn: number }).expiresIn).toBe(3600);
  });
});

describe("T-050: createDownloadRouteHandler — construction-time expiresIn cap", () => {
  it("throws FileSystemError SYNCHRONOUSLY when expiresIn > 7 days (S3 SigV4 limit)", () => {
    const fs = makeFs();
    expect(() => createDownloadRouteHandler({ fs, expiresIn: 8 * 86400 })).toThrow(FileSystemError);
    try {
      createDownloadRouteHandler({ fs, expiresIn: 8 * 86400 });
    } catch (e) {
      expect(e).toBeInstanceOf(FileSystemError);
      const err = e as FileSystemError;
      expect(err.cause?.code).toBe("InvalidArgument");
      expect(err.retryable).toBe(false);
    }
  });

  it("accepts expiresIn at exactly 7 days (S3 SigV4 cap)", () => {
    const fs = makeFs();
    expect(() => createDownloadRouteHandler({ fs, expiresIn: 7 * 86400 })).not.toThrow();
  });

  it("throws when expiresIn is 0 or negative", () => {
    const fs = makeFs();
    expect(() => createDownloadRouteHandler({ fs, expiresIn: 0 })).toThrow(FileSystemError);
    expect(() => createDownloadRouteHandler({ fs, expiresIn: -1 })).toThrow(FileSystemError);
  });
});
