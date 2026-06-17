/**
 * Tests for `getPublicUrl` — pure URL builder, no HTTP calls.
 *
 * Verifies the three URL shapes:
 *   - S3 virtual-hosted (default, forcePathStyle: false)
 *   - S3 path-style (forcePathStyle: true)
 *   - R2 (always path-style, uses the account endpoint)
 *
 * The function is async to match the S3CompatibleAdapter contract
 * (every method returns a Promise), even though it does no I/O.
 */
import { describe, it, expect } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { getPublicUrl } from "@/storage/s3-adapter/get-public-url";
import { asS3Key } from "@/types/branded";
import type { FileSystemConfig } from "@/storage/config";

const client = new S3Client({ region: "us-east-1" });

describe("T-019: getPublicUrl — S3CompatibleAdapter", () => {
  it("S3 virtual-hosted (default): https://{bucket}.s3.{region}.amazonaws.com/{key}", async () => {
    const config: FileSystemConfig = {
      provider: "s3",
      bucket: "my-bucket",
      region: "us-east-1",
      credentials: { accessKeyId: "a", secretAccessKey: "b" },
      forcePathStyle: false,
    };
    const result = await getPublicUrl(client, config, { key: asS3Key("uploads/x.txt") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.url).toBe("https://my-bucket.s3.us-east-1.amazonaws.com/uploads/x.txt");
  });

  it("S3 path-style with custom endpoint (MinIO-compatible): https://{endpoint}/{bucket}/{key}", async () => {
    const config: FileSystemConfig = {
      provider: "s3",
      bucket: "my-bucket",
      region: "us-east-1",
      endpoint: "http://localhost:9000",
      credentials: { accessKeyId: "a", secretAccessKey: "b" },
      forcePathStyle: true,
    };
    const result = await getPublicUrl(client, config, { key: asS3Key("uploads/x.txt") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.url).toBe("http://localhost:9000/my-bucket/uploads/x.txt");
  });

  it("S3 path-style without endpoint: https://s3.{region}.amazonaws.com/{bucket}/{key}", async () => {
    const config: FileSystemConfig = {
      provider: "s3",
      bucket: "my-bucket",
      region: "us-east-1",
      credentials: { accessKeyId: "a", secretAccessKey: "b" },
      forcePathStyle: true,
    };
    const result = await getPublicUrl(client, config, { key: asS3Key("uploads/x.txt") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.url).toBe("https://s3.us-east-1.amazonaws.com/my-bucket/uploads/x.txt");
  });

  it("R2 (always path-style, account endpoint): https://{endpoint}/{bucket}/{key}", async () => {
    const config: FileSystemConfig = {
      provider: "r2",
      bucket: "my-bucket",
      endpoint: "https://accountid.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "a", secretAccessKey: "b" },
      forcePathStyle: true,
    };
    const result = await getPublicUrl(client, config, { key: asS3Key("uploads/x.txt") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.url).toBe(
      "https://accountid.r2.cloudflarestorage.com/my-bucket/uploads/x.txt",
    );
  });

  it("strips trailing slash from endpoint", async () => {
    const config: FileSystemConfig = {
      provider: "r2",
      bucket: "my-bucket",
      endpoint: "https://accountid.r2.cloudflarestorage.com/",
      credentials: { accessKeyId: "a", secretAccessKey: "b" },
      forcePathStyle: true,
    };
    const result = await getPublicUrl(client, config, { key: asS3Key("uploads/x.txt") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.url).toBe(
      "https://accountid.r2.cloudflarestorage.com/my-bucket/uploads/x.txt",
    );
  });
});
