/**
 * Tests for the `setMetadata` S3 adapter method.
 *
 * S3 has no native PATCH-metadata; we use a self-CopyObject with
 * `MetadataDirective: REPLACE|COPY` to (re)set user metadata.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, CopyObjectCommand } from "@aws-sdk/client-s3";
import { setMetadata } from "@/storage/s3-adapter/set-metadata";
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

describe("T-017: setMetadata — S3CompatibleAdapter", () => {
  beforeEach(() => s3Mock.reset());

  it("happy path: merge mode (default) uses MetadataDirective: COPY", async () => {
    s3Mock.on(CopyObjectCommand).resolves({});
    const result = await setMetadata(client, config, {
      key: asS3Key("uploads/x.txt"),
      metadata: { version: "2" },
    });
    expect(result.ok).toBe(true);
    const calls = s3Mock.commandCalls(CopyObjectCommand);
    expect(calls[0]?.args[0]?.input.MetadataDirective).toBe("COPY");
    expect(calls[0]?.args[0]?.input.Metadata).toEqual({ version: "2" });
    // CopySource must point at self
    expect(calls[0]?.args[0]?.input.CopySource).toBe("test-bucket/uploads/x.txt");
  });

  it("replace mode uses MetadataDirective: REPLACE", async () => {
    s3Mock.on(CopyObjectCommand).resolves({});
    const result = await setMetadata(client, config, {
      key: asS3Key("uploads/x.txt"),
      metadata: { author: "tester" },
      replace: true,
    });
    expect(result.ok).toBe(true);
    const calls = s3Mock.commandCalls(CopyObjectCommand);
    expect(calls[0]?.args[0]?.input.MetadataDirective).toBe("REPLACE");
  });

  it("missing key: NoSuchKey -> NotFound", async () => {
    s3Mock.on(CopyObjectCommand).rejects({
      name: "NoSuchKey",
      message: "missing",
      $metadata: { httpStatusCode: 404 },
    });
    const result = await setMetadata(client, config, {
      key: asS3Key("missing.txt"),
      metadata: { version: "1" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NotFound");
  });
});
