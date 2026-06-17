/**
 * Tests for the `delete`, `exists`, `copy`, and `move` S3 adapter methods.
 *
 * `move` is implemented as CopyObject + DeleteObject (S3 has no
 * native rename). The order matters: copy first, delete only if
 * the copy succeeded — otherwise we'd lose the source.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, DeleteObjectCommand, HeadObjectCommand, CopyObjectCommand } from "@aws-sdk/client-s3";
import { deleteObject } from "@/storage/s3-adapter/delete";
import { existsObject } from "@/storage/s3-adapter/exists";
import { copyObject } from "@/storage/s3-adapter/copy";
import { moveObject } from "@/storage/s3-adapter/move";
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

describe("T-016a: delete — S3CompatibleAdapter", () => {
  beforeEach(() => s3Mock.reset());

  it("happy path: deletes an existing object", async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});
    const result = await deleteObject(client, config, { key: asS3Key("uploads/x.txt") });
    expect(result.ok).toBe(true);
  });

  it("missing key: idempotent (returns ok, no error)", async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});
    const result = await deleteObject(client, config, { key: asS3Key("missing.txt") });
    expect(result.ok).toBe(true);
  });

  it("S3 error: maps to FileSystemError", async () => {
    s3Mock.on(DeleteObjectCommand).rejects({
      name: "AccessDenied",
      message: "x",
      $metadata: { httpStatusCode: 403 },
    });
    const result = await deleteObject(client, config, { key: asS3Key("x.txt") });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("Forbidden");
  });
});

describe("T-016b: exists — S3CompatibleAdapter (boolean query, NOT an error)", () => {
  beforeEach(() => s3Mock.reset());

  it("existing key: returns ok(true)", async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 42 });
    const result = await existsObject(client, config, { key: asS3Key("uploads/x.txt") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exists).toBe(true);
  });

  it("missing key (404): returns ok(false) — NOT a NotFound error", async () => {
    s3Mock.on(HeadObjectCommand).rejects({
      name: "NoSuchKey",
      message: "missing",
      $metadata: { httpStatusCode: 404 },
    });
    const result = await existsObject(client, config, { key: asS3Key("missing.txt") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exists).toBe(false);
  });

  it("other S3 error: returns FileSystemError (NOT ok)", async () => {
    s3Mock.on(HeadObjectCommand).rejects({
      name: "AccessDenied",
      message: "x",
      $metadata: { httpStatusCode: 403 },
    });
    const result = await existsObject(client, config, { key: asS3Key("x.txt") });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("Forbidden");
  });
});

describe("T-016c: copy — S3CompatibleAdapter", () => {
  beforeEach(() => s3Mock.reset());

  it("happy path: copies within the same bucket", async () => {
    s3Mock.on(CopyObjectCommand).resolves({
      CopyObjectResult: { ETag: "etag-new" },
      VersionId: "v-new",
    } as never);
    const result = await copyObject(client, config, {
      sourceKey: asS3Key("a.txt"),
      destinationKey: asS3Key("b.txt"),
    });
    expect(result.ok).toBe(true);

    const calls = s3Mock.commandCalls(CopyObjectCommand);
    expect(calls[0]?.args[0]?.input.Bucket).toBe("test-bucket");
    expect(calls[0]?.args[0]?.input.Key).toBe("b.txt");
    expect(calls[0]?.args[0]?.input.CopySource).toBe("test-bucket/a.txt");
  });

  it("source missing: maps NoSuchKey -> NotFound", async () => {
    s3Mock.on(CopyObjectCommand).rejects({
      name: "NoSuchKey",
      message: "missing",
      $metadata: { httpStatusCode: 404 },
    });
    const result = await copyObject(client, config, {
      sourceKey: asS3Key("missing.txt"),
      destinationKey: asS3Key("b.txt"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NotFound");
  });
});

describe("T-016d: move — S3CompatibleAdapter (CopyObject + DeleteObject)", () => {
  beforeEach(() => s3Mock.reset());

  it("happy path: copies then deletes the source", async () => {
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});

    const result = await moveObject(client, config, {
      sourceKey: asS3Key("a.txt"),
      destinationKey: asS3Key("b.txt"),
    });
    expect(result.ok).toBe(true);
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(1);
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });

  it("copy fails: source is NOT deleted (atomic-ish)", async () => {
    s3Mock.on(CopyObjectCommand).rejects({
      name: "NoSuchKey",
      message: "missing",
      $metadata: { httpStatusCode: 404 },
    });
    const result = await moveObject(client, config, {
      sourceKey: asS3Key("missing.txt"),
      destinationKey: asS3Key("b.txt"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NotFound");
    // Delete was NEVER called (we short-circuit on copy failure).
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(0);
  });
});
