/**
 * Tests for the `read`, `stat`, and `getMetadata` S3 adapter methods.
 *
 * read uses `GetObjectCommand` (a body-bearing call). stat and
 * getMetadata both use `HeadObjectCommand` (cheap metadata-only
 * HEAD); getMetadata returns only the user-metadata subset so
 * callers can fetch JUST the metadata without paying for size/etag
 * in their application logic.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { readObject } from "@/storage/s3-adapter/read";
import { statObject } from "@/storage/s3-adapter/stat";
import { getMetadata } from "@/storage/s3-adapter/get-metadata";
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

// Helper: turn a string into an SDK-shaped body. The real S3
// response uses an SDK stream which is also AsyncIterable. The
// test casts through `unknown` because the SDK body type union
// (StreamingBlobPayloadOutputTypes) is wider than what the
// adapter actually consumes.
const streamFrom = (s: string): unknown =>
  Readable.from(Buffer.from(s, "utf-8"));

describe("T-014a: read — S3CompatibleAdapter", () => {
  beforeEach(() => s3Mock.reset());

  it("happy path: returns the object body as Uint8Array", async () => {
    s3Mock.on(GetObjectCommand).resolves({
      Body: streamFrom("hello world") as never,
      ContentType: "text/plain",
      Metadata: { author: "tester" },
    });

    const result = await readObject(client, config, { key: asS3Key("uploads/hello.txt") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.body).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result.value.body)).toBe("hello world");
    expect(result.value.contentType).toBe("text/plain");
    expect(result.value.metadata).toEqual({ author: "tester" });
  });

  it("missing key: maps NoSuchKey -> NotFound", async () => {
    s3Mock.on(GetObjectCommand).rejects({
      name: "NoSuchKey",
      message: "The specified key does not exist.",
      $metadata: { httpStatusCode: 404 },
    });
    const result = await readObject(client, config, { key: asS3Key("missing.txt") });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NotFound");
    expect(result.error.cause?.code).toBe("NoSuchKey");
  });
});

describe("T-014b: stat — S3CompatibleAdapter", () => {
  beforeEach(() => s3Mock.reset());

  it("happy path: returns the full HEAD metadata", async () => {
    s3Mock.on(HeadObjectCommand).resolves({
      ContentLength: 42,
      ETag: "abc123",
      ContentType: "application/json",
      LastModified: new Date("2026-01-01T00:00:00Z"),
      Metadata: { author: "tester" },
    });

    const result = await statObject(client, config, { key: asS3Key("uploads/data.json") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      key: "uploads/data.json",
      size: 42,
      etag: "abc123",
      contentType: "application/json",
      lastModified: new Date("2026-01-01T00:00:00Z"),
      metadata: { author: "tester" },
    });
  });

  it("missing key: maps NoSuchKey -> NotFound", async () => {
    s3Mock.on(HeadObjectCommand).rejects({
      name: "NoSuchKey",
      message: "missing",
      $metadata: { httpStatusCode: 404 },
    });
    const result = await statObject(client, config, { key: asS3Key("missing.txt") });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NotFound");
  });
});

describe("T-014c: getMetadata — S3CompatibleAdapter (user metadata only)", () => {
  beforeEach(() => s3Mock.reset());

  it("returns just the user metadata, not size/etag", async () => {
    s3Mock.on(HeadObjectCommand).resolves({
      ContentLength: 42,
      ETag: "abc123",
      ContentType: "application/json",
      LastModified: new Date(),
      Metadata: { author: "tester", version: "1" },
    });

    const result = await getMetadata(client, config, { key: asS3Key("uploads/data.json") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ author: "tester", version: "1" });
  });

  it("missing key: maps NoSuchKey -> NotFound", async () => {
    s3Mock.on(HeadObjectCommand).rejects({
      name: "NoSuchKey",
      message: "missing",
      $metadata: { httpStatusCode: 404 },
    });
    const result = await getMetadata(client, config, { key: asS3Key("missing.txt") });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NotFound");
  });
});
