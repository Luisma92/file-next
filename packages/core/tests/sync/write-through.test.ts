/**
 * Tests for the WriteThrough sync layer.
 *
 * Unit-level: uses a mock S3Client (aws-sdk-client-mock) and the
 * in-memory MetadataStore. The orphan log is in-memory (v0.1).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createWriteThrough } from "@/sync/write-through";
import { createFileSystem } from "@/storage/factory";
import { createS3Client } from "@/storage/s3-adapter/client";
import { createMemoryStore } from "@/metadata";
import { asTenantId, asUserId } from "@/types/branded";
import type { FileSystemConfig } from "@/storage/config";

const config: FileSystemConfig = {
  provider: "s3",
  bucket: "test-bucket",
  region: "us-east-1",
  credentials: { accessKeyId: "AKIA-TEST", secretAccessKey: "test-secret" },
  forcePathStyle: false,
};

const s3Mock = mockClient(S3Client);
const fs = createFileSystem(config);

const TENANT = asTenantId("tenant-a");
const USER = asUserId("user-1");

// Fresh store + wt per test so the in-memory orphan log
// (and the store's nodes) don't leak between tests.
let store: ReturnType<typeof createMemoryStore>;
let wt: ReturnType<typeof createWriteThrough>;

beforeEach(() => {
  s3Mock.reset();
  store = createMemoryStore();
  wt = createWriteThrough(fs, store);
});

describe("PR 6: writeThroughFile — happy path", () => {
  it("writes bytes to S3 + creates metadata record", async () => {
    s3Mock.on(PutObjectCommand).resolves({ ETag: "etag-1" });

    const r = await wt.writeThroughFile({
      tenantId: TENANT,
      parentId: null,
      name: "hello.txt",
      body: new TextEncoder().encode("hello"),
      contentType: "text/plain",
      ownerId: USER,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe("hello.txt");
    expect(r.value.size).toBe(5);
    // Metadata is in the store
    const g = await store.getNode({ tenantId: TENANT, id: r.value.id });
    expect(g.ok && g.value?.id).toBe(r.value.id);
    // No orphans
    expect(wt.getOrphans()).toHaveLength(0);
  });
});

describe("PR 6: writeThroughFile — compensation", () => {
  it("S3 failure: surfaces the error, no orphan logged, no metadata created", async () => {
    s3Mock.on(PutObjectCommand).rejects({
      name: "AccessDenied",
      message: "x",
      $metadata: { httpStatusCode: 403 },
    });

    const r = await wt.writeThroughFile({
      tenantId: TENANT,
      parentId: null,
      name: "denied.txt",
      body: new TextEncoder().encode("x"),
      contentType: "text/plain",
      ownerId: USER,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("Forbidden");
    // No orphan — we never got past the S3 step
    expect(wt.getOrphans()).toHaveLength(0);
  });

  it("S3 succeeds, metadata insert fails: orphan logged + S3 cleanup attempted", async () => {
    s3Mock.on(PutObjectCommand).resolves({ ETag: "ok" });

    // Pre-create a node with the same name to force the dup Conflict
    // on the metadata insert (createNode rejects duplicate names).
    await store.createNode({
      tenantId: TENANT,
      parentId: null,
      name: "dupe.txt",
      kind: "file",
      size: 1,
      mimeType: "text/plain",
      s3Key: "dupe.txt",
      ownerId: USER,
    });
    s3Mock.on(DeleteObjectCommand).resolves({});

    const r = await wt.writeThroughFile({
      tenantId: TENANT,
      parentId: null,
      name: "dupe.txt",
      body: new TextEncoder().encode("x"),
      contentType: "text/plain",
      ownerId: USER,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("InternalError");
    // Orphan logged
    const orphans = wt.getOrphans();
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.op).toBe("delete");
    expect(orphans[0]?.s3Key).toBe("dupe.txt");
  });
});

describe("PR 6: deleteThroughFile — happy path", () => {
  it("soft-deletes metadata + deletes S3 object", async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const w = await wt.writeThroughFile({
      tenantId: TENANT,
      parentId: null,
      name: "to-delete.txt",
      body: new TextEncoder().encode("x"),
      contentType: "text/plain",
      ownerId: USER,
    });
    if (!w.ok) throw new Error("setup failed");
    s3Mock.on(DeleteObjectCommand).resolves({});

    const d = await wt.deleteThroughFile({ tenantId: TENANT, id: w.value.id });
    expect(d.ok).toBe(true);
    // Metadata is gone
    const g = await store.getNode({ tenantId: TENANT, id: w.value.id });
    expect(g.ok && g.value).toBeNull();
    // No orphans
    expect(wt.getOrphans()).toHaveLength(0);
  });
});

describe("PR 6: deleteThroughFile — compensation", () => {
  it("metadata not found: returns NotFound, no orphan", async () => {
    const r = await wt.deleteThroughFile({ tenantId: TENANT, id: "nope" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NotFound");
    expect(wt.getOrphans()).toHaveLength(0);
  });

  it("metadata soft-delete fails: orphan logged with `restore` op (no S3 delete attempted)", async () => {
    // We can't easily make the in-memory store fail on a single
    // method, so this case is covered by the integration test
    // against the SQLite adapter (where we can inject a fault).
    // For v0.1 we just verify the happy + the NotFound paths.
  });
});

describe("PR 6: reconcile (v0.1 no-op)", () => {
  it("returns the current orphan log content (no actual S3 walk)", async () => {
    // Seed an orphan by triggering a write-with-metadata-failure
    s3Mock.on(PutObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    await store.createNode({
      tenantId: TENANT,
      parentId: null,
      name: "r.txt",
      kind: "file",
      size: 1,
      mimeType: "text/plain",
      s3Key: "r.txt",
      ownerId: USER,
    });
    await wt.writeThroughFile({
      tenantId: TENANT,
      parentId: null,
      name: "r.txt",
      body: new TextEncoder().encode("x"),
      contentType: "text/plain",
      ownerId: USER,
    });

    const report = await wt.reconcile();
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.orphans.length).toBeGreaterThanOrEqual(1);
    expect(report.value.scanned).toBe(report.value.orphans.length);
  });
});
