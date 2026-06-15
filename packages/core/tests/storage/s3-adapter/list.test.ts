/**
 * Tests for the `list` S3 adapter method.
 *
 * Uses `aws-sdk-client-mock` to patch the `S3Client` prototype so
 * we can drive the `ListObjectsV2` command with canned responses
 * (no real network, deterministic, fast). The integration test
 * against MinIO lives in PR 2c.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { listObjects } from "@/storage/s3-adapter/list";
import { asPrefix } from "@/types/branded";
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

describe("T-013: list — S3CompatibleAdapter", () => {
  beforeEach(() => s3Mock.reset());

  it("happy path: 1 page, returns items and prefixes", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: "uploads/a.txt", Size: 100, LastModified: new Date("2026-01-01T00:00:00Z") },
        { Key: "uploads/b.txt", Size: 200, LastModified: new Date("2026-01-02T00:00:00Z") },
      ],
      CommonPrefixes: [{ Prefix: "uploads/sub/" }],
    });

    const result = await listObjects(client, config, { prefix: asPrefix("uploads/") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(2);
    expect(result.value.items[0]?.key).toBe("uploads/a.txt");
    expect(result.value.items[0]?.size).toBe(100);
    expect(result.value.prefixes).toEqual(["uploads/sub/"]);
    expect(result.value.nextContinuationToken).toBeUndefined();
  });

  it("pagination: returns nextContinuationToken when more pages exist", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "x.txt", Size: 1, LastModified: new Date() }],
      CommonPrefixes: [],
      NextContinuationToken: "page-2-token",
      IsTruncated: true,
    });

    const result = await listObjects(client, config, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextContinuationToken).toBe("page-2-token");
  });

  it("empty bucket: no Contents, no CommonPrefixes", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({});
    const result = await listObjects(client, config, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toEqual([]);
    expect(result.value.prefixes).toEqual([]);
  });

  it("NoSuchBucket: maps to NotFound", async () => {
    s3Mock.on(ListObjectsV2Command).rejects({
      name: "NoSuchBucket",
      message: "The specified bucket does not exist",
      $metadata: { httpStatusCode: 404 },
    });
    const result = await listObjects(client, config, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NotFound");
    expect(result.error.retryable).toBe(false);
    expect(result.error.cause?.code).toBe("NoSuchBucket");
  });

  it("network error: maps to NetworkError", async () => {
    s3Mock.on(ListObjectsV2Command).rejects({
      name: "NetworkingError",
      message: "socket hang up",
    });
    const result = await listObjects(client, config, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NetworkError");
    expect(result.error.retryable).toBe(true);
  });

  it("passes delimiter through to S3 for CommonPrefixes emulation", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [],
      CommonPrefixes: [{ Prefix: "a/b/" }, { Prefix: "a/c/" }],
    });
    const result = await listObjects(client, config, { prefix: asPrefix("a/"), delimiter: "/" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.prefixes).toEqual(["a/b/", "a/c/"]);
    const calls = s3Mock.commandCalls(ListObjectsV2Command);
    expect(calls[0]?.args[0]?.input.Delimiter).toBe("/");
  });
});
