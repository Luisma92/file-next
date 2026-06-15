/**
 * Tests for the `write` S3 adapter method.
 *
 * write uses `PutObjectCommand` (a single-PUT upload). v0.1 does
 * NOT support server-side multipart; objects > 5GB return
 * `PayloadTooLarge` (retryable: false) at the adapter level so
 * the consumer knows to chunk client-side or wait for the v0.2
 * multipart support.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { writeObject } from "@/storage/s3-adapter/write";
import { asS3Key } from "@/types/branded";
import type { FileSystemConfig } from "@/storage/config";

const s3Mock = mockClient(S3Client);

const config: FileSystemConfig = {
  provider: "s3",
  bucket: "test-bucket",
  region: "us-east-1",
  credentials: { accessKeyId: "AKIA-TEST", secretAccessKey: "test-secret" },
  forcePathStyle: false,
};

const client = new S3Client({ region: "us-east-1" });

const FIVE_GB = 5 * 1024 * 1024 * 1024;

describe("T-015: write — S3CompatibleAdapter", () => {
  beforeEach(() => s3Mock.reset());

  it("happy path: uploads a small object, returns etag", async () => {
    s3Mock.on(PutObjectCommand).resolves({ ETag: "etag-abc", VersionId: "v-1" });

    const result = await writeObject(client, config, {
      key: asS3Key("uploads/hello.txt"),
      body: new TextEncoder().encode("hello"),
      contentType: "text/plain",
      metadata: { author: "tester" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.etag).toBe("etag-abc");
    expect(result.value.versionId).toBe("v-1");
  });

  it("passes contentType and metadata through to PutObject", async () => {
    s3Mock.on(PutObjectCommand).resolves({ ETag: "x" });

    await writeObject(client, config, {
      key: asS3Key("uploads/data.json"),
      body: new TextEncoder().encode("{}"),
      contentType: "application/json",
      metadata: { version: "1" },
    });

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls[0]?.args[0]?.input.ContentType).toBe("application/json");
    expect(calls[0]?.args[0]?.input.Metadata).toEqual({ version: "1" });
  });

  it("object > 5GB: returns PayloadTooLarge (retryable: false) before sending", async () => {
    const body = new Uint8Array(FIVE_GB + 1);
    const result = await writeObject(client, config, {
      key: asS3Key("uploads/big.bin"),
      body,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PayloadTooLarge");
    expect(result.error.retryable).toBe(false);
    // The command was NEVER sent (cap is client-side).
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it("object exactly 5GB: accepted (cap is >, not >=)", async () => {
    s3Mock.on(PutObjectCommand).resolves({ ETag: "x" });
    const body = new Uint8Array(FIVE_GB);
    const result = await writeObject(client, config, {
      key: asS3Key("uploads/exact.bin"),
      body,
    });
    expect(result.ok).toBe(true);
  });

  it("S3 error: maps to FileSystemError via fromAws", async () => {
    s3Mock.on(PutObjectCommand).rejects({
      name: "AccessDenied",
      message: "Access Denied",
      $metadata: { httpStatusCode: 403 },
    });
    const result = await writeObject(client, config, {
      key: asS3Key("uploads/x.txt"),
      body: new TextEncoder().encode("x"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("Forbidden");
  });
});
