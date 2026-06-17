/**
 * Integration tests for the 13-method S3CompatibleAdapter contract.
 *
 * These tests run against a REAL S3-compatible endpoint (MinIO by
 * default for local dev; works against AWS S3 / Cloudflare R2 / any
 * S3-compatible provider with the same env vars). They are NOT
 * part of the default `pnpm test:run` suite — the suite would
 * skip them when no endpoint is configured.
 *
 * Local dev setup (MinIO via Docker):
 *
 *   docker run -d --name file-next-minio \
 *     -p 9000:9000 -p 9001:9001 \
 *     -e MINIO_ROOT_USER=test \
 *     -e MINIO_ROOT_PASSWORD=test12345 \
 *     minio/minio server /data --console-address ":9001"
 *
 *   export INTEGRATION_S3_ENDPOINT=http://localhost:9000
 *   export INTEGRATION_S3_REGION=us-east-1
 *   export INTEGRATION_S3_BUCKET=file-next-integration
 *   export INTEGRATION_S3_ACCESS_KEY_ID=test
 *   export INTEGRATION_S3_SECRET_ACCESS_KEY=test12345
 *   export INTEGRATION_S3_FORCE_PATH_STYLE=true
 *
 *   pnpm test:integration
 *
 * For CI: GitHub Actions can spin up MinIO as a service container
 * with the same env vars; no testcontainers dep needed.
 *
 * For AWS S3: drop INTEGRATION_S3_ENDPOINT and
 * INTEGRATION_S3_FORCE_PATH_STYLE; provide a real region + creds.
 *
 * For R2: set INTEGRATION_S3_ENDPOINT to the account endpoint,
 * INTEGRATION_S3_FORCE_PATH_STYLE=true, region can be "auto".
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { createFileSystem } from "../../src/storage/factory";
import { createS3Client } from "../../src/storage/s3-adapter/client";
import { asPrefix, asS3Key } from "../../src/types/branded";
import { FileSystemError } from "../../src/errors";
import type { FileSystemConfig } from "../../src/storage/config";

// ---------------------------------------------------------------------------
// Env gate: skip the entire suite if no endpoint is configured
// ---------------------------------------------------------------------------

const env = {
  endpoint: process.env.INTEGRATION_S3_ENDPOINT,
  region: process.env.INTEGRATION_S3_REGION ?? "us-east-1",
  bucket: process.env.INTEGRATION_S3_BUCKET ?? "file-next-integration",
  accessKeyId: process.env.INTEGRATION_S3_ACCESS_KEY_ID ?? "test",
  secretAccessKey: process.env.INTEGRATION_S3_SECRET_ACCESS_KEY ?? "test12345",
  forcePathStyle: process.env.INTEGRATION_S3_FORCE_PATH_STYLE === "true",
};

const skipReason = !env.endpoint
  ? "INTEGRATION_S3_ENDPOINT not set — skipping. See header for local dev setup with MinIO."
  : null;

const config: FileSystemConfig = {
  provider: "s3",
  bucket: env.bucket,
  region: env.region,
  endpoint: env.endpoint,
  credentials: { accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey },
  forcePathStyle: env.forcePathStyle,
};

const client: S3Client = createS3Client(config);
const fs = createFileSystem(config);

const PREFIX = `it-${Date.now()}/`;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(skipReason !== null)("Integration: S3CompatibleAdapter against a real S3-compatible endpoint", () => {
  beforeAll(async () => {
    // Create the bucket (idempotent — HeadBucket first, swallow NotFound).
    try {
      await client.send(new HeadBucketCommand({ Bucket: env.bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: env.bucket }));
    }

    // CORS so the test can be re-used as a template for browser
    // uploads. PUT + GET from any origin.
    await client.send(
      new PutBucketCorsCommand({
        Bucket: env.bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedHeaders: ["*"],
              AllowedMethods: ["PUT", "GET", "POST", "DELETE", "HEAD"],
              AllowedOrigins: ["*"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 3000,
            },
          ],
        },
      }),
    );
  }, 30_000);

  afterAll(async () => {
    // Clean up: delete every object under the test prefix, then
    // the bucket (best-effort; the bucket is left in place for
    // re-runs unless INTEGRATION_S3_CLEANUP_BUCKET=true).
    try {
      const list = await fs.adapter.list({ prefix: asPrefix(PREFIX) });
      if (list.ok && list.value.items.length > 0) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: env.bucket,
            Delete: {
              Objects: list.value.items.map((i) => ({ Key: i.key })),
            },
          }),
        );
      }
    } catch {
      // best-effort
    }
    if (process.env.INTEGRATION_S3_CLEANUP_BUCKET === "true") {
      try {
        await client.send(new DeleteBucketCommand({ Bucket: env.bucket }));
      } catch {
        // best-effort
      }
    }
  }, 30_000);

  // -----------------------------------------------------------------------
  // The 13 methods, end-to-end against a real S3-compatible endpoint
  // -----------------------------------------------------------------------

  it("write + read roundtrip preserves body + contentType + metadata", async () => {
    const key = `${PREFIX}roundtrip.txt`;
    const body = new TextEncoder().encode("integration roundtrip body");
    const w = await fs.adapter.write({
      key: asS3Key(key),
      body,
      contentType: "text/plain",
      metadata: { author: "integration" },
    });
    expect(w.ok).toBe(true);

    const r = await fs.adapter.read({ key: asS3Key(key) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(new TextDecoder().decode(r.value.body)).toBe("integration roundtrip body");
    expect(r.value.contentType).toBe("text/plain");
    expect(r.value.metadata).toEqual({ author: "integration" });
  });

  it("stat returns the full HEAD shape", async () => {
    const key = `${PREFIX}stat-target.txt`;
    await fs.adapter.write({ key: asS3Key(key), body: new TextEncoder().encode("x") });

    const s = await fs.adapter.stat({ key: asS3Key(key) });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.value.key).toBe(key);
    expect(s.value.size).toBe(1);
    expect(s.value.etag).toMatch(/.+/);
    expect(s.value.contentType).toBe("application/octet-stream");
    expect(s.value.lastModified).toBeInstanceOf(Date);
  });

  it("exists returns true for present, false for missing (NOT a NotFound error)", async () => {
    const present = `${PREFIX}exists-present.txt`;
    await fs.adapter.write({ key: asS3Key(present), body: new Uint8Array() });

    const a = await fs.adapter.exists({ key: asS3Key(present) });
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.value.exists).toBe(true);

    const b = await fs.adapter.exists({ key: asS3Key(`${PREFIX}does-not-exist.txt`) });
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.value.exists).toBe(false);
  });

  it("list paginates and returns items + prefixes with delimiter", async () => {
    const root = `${PREFIX}list-root/`;
    await fs.adapter.write({ key: asS3Key(`${root}a.txt`), body: new Uint8Array() });
    await fs.adapter.write({ key: asS3Key(`${root}b.txt`), body: new Uint8Array() });
    await fs.adapter.write({ key: asS3Key(`${root}sub/c.txt`), body: new Uint8Array() });

    const flat = await fs.adapter.list({ prefix: asPrefix(root) });
    expect(flat.ok).toBe(true);
    if (!flat.ok) return;
    expect(flat.value.items.length).toBeGreaterThanOrEqual(3);

    const grouped = await fs.adapter.list({
      prefix: asPrefix(root),
      delimiter: "/",
    });
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    expect(grouped.value.items.length).toBe(2); // a.txt + b.txt
    expect(grouped.value.prefixes).toContain(`${root}sub/`);
  });

  it("getMetadata returns just the user-metadata subset", async () => {
    const key = `${PREFIX}meta.txt`;
    await fs.adapter.write({
      key: asS3Key(key),
      body: new Uint8Array(),
      metadata: { author: "it-test", version: "1" },
    });

    const m = await fs.adapter.getMetadata({ key: asS3Key(key) });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.value).toMatchObject({ author: "it-test", version: "1" });
  });

  it("setMetadata replaces the user-metadata (REPLACE mode)", async () => {
    const key = `${PREFIX}set-meta.txt`;
    await fs.adapter.write({
      key: asS3Key(key),
      body: new Uint8Array(),
      metadata: { a: "1", b: "2" },
    });

    const r = await fs.adapter.setMetadata({
      key: asS3Key(key),
      metadata: { c: "3" },
      replace: true,
    });
    expect(r.ok).toBe(true);

    const m = await fs.adapter.getMetadata({ key: asS3Key(key) });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.value).toEqual({ c: "3" });
  });

  it("copy + move roundtrip within the same bucket", async () => {
    const src = `${PREFIX}move-src.txt`;
    const dst = `${PREFIX}move-dst.txt`;
    await fs.adapter.write({ key: asS3Key(src), body: new TextEncoder().encode("move me") });

    const c = await fs.adapter.copy({ sourceKey: asS3Key(src), destinationKey: asS3Key(dst) });
    expect(c.ok).toBe(true);
    const r1 = await fs.adapter.read({ key: asS3Key(dst) });
    expect(r1.ok).toBe(true);

    const m = await fs.adapter.move({ sourceKey: asS3Key(src), destinationKey: asS3Key(dst) });
    expect(m.ok).toBe(true);
    const ex = await fs.adapter.exists({ key: asS3Key(src) });
    expect(ex.ok).toBe(true);
    if (ex.ok) expect(ex.value.exists).toBe(false);
  });

  it("delete is idempotent (deleting a missing key still returns ok)", async () => {
    const r = await fs.adapter.delete({ key: asS3Key(`${PREFIX}never-existed.txt`) });
    expect(r.ok).toBe(true);
  });

  it("createPresignedUploadUrl returns a real presigned URL", async () => {
    const r = await fs.adapter.createPresignedUploadUrl({
      key: asS3Key(`${PREFIX}presigned-put.txt`),
      contentType: "text/plain",
      expiresIn: 60,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.url).toMatch(/X-Amz-Signature=/);
    expect(r.value.url).toMatch(/X-Amz-Expires=60/);
    expect(r.value.method).toBe("PUT");
  });

  it("createPresignedDownloadUrl returns a real presigned URL", async () => {
    const key = `${PREFIX}presigned-get.txt`;
    await fs.adapter.write({ key: asS3Key(key), body: new TextEncoder().encode("get me") });

    const r = await fs.adapter.createPresignedDownloadUrl({
      key: asS3Key(key),
      expiresIn: 60,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.url).toMatch(/X-Amz-Signature=/);
    expect(r.value.url).toMatch(/X-Amz-Expires=60/);
  });

  it("getPublicUrl builds the public URL for the configured addressing style", async () => {
    const r = await fs.adapter.getPublicUrl({ key: asS3Key(`${PREFIX}any.txt`) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (config.forcePathStyle && config.endpoint) {
      expect(r.value.url).toContain(env.bucket);
      expect(r.value.url).toContain(PREFIX);
    } else if (!config.forcePathStyle) {
      expect(r.value.url).toMatch(new RegExp(`^https://${config.bucket}\\.s3\\.`));
    }
  });

  it("error mapping: missing key on read -> NotFound (FileSystemError, not a raw SDK error)", async () => {
    const r = await fs.adapter.read({ key: asS3Key(`${PREFIX}nope-${Date.now()}.txt`) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBeInstanceOf(FileSystemError);
    expect(r.error.code).toBe("NotFound");
    expect(r.error.cause?.code).toBe("NoSuchKey");
  });
});
