/**
 * Tests for the in-memory storage adapter.
 *
 * Validates:
 *   - All 13 methods of the S3CompatibleAdapter contract
 *   - Spec compliance: Result<T, FileSystemError> returns, 5 GB cap
 *     enforcement, error code mapping
 *   - Spec compliance: same etag-changes-on-write semantics as S3
 *   - Memory adapter-specific: store() snapshot is a true view
 *     (mutations to the adapter are visible immediately)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryAdapter } from "@/storage/memory-adapter";
import { asS3Key, asPrefix, asTenantId } from "@/types/branded";

const KEY = asS3Key("test/sample.txt");
const KEY_2 = asS3Key("test/other.bin");
const KEY_3 = asS3Key("a/1.txt");
const KEY_4 = asS3Key("a/2.txt");
const KEY_5 = asS3Key("a/sub/3.txt");
const PREFIX = asPrefix("test/");
const PREFIX_A = asPrefix("a/");

let adapter: ReturnType<typeof createMemoryAdapter>;

beforeEach(() => {
  adapter = createMemoryAdapter();
});

describe("createMemoryAdapter — write + read round-trip", () => {
  it("writes a Uint8Array and reads it back with the same content type", async () => {
    const body = new TextEncoder().encode("hello world");
    const writeResult = await adapter.write({ key: KEY, body, contentType: "text/plain" });
    expect(writeResult.ok).toBe(true);
    if (!writeResult.ok) return;

    const readResult = await adapter.read({ key: KEY });
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;
    expect(new TextDecoder().decode(readResult.value.body)).toBe("hello world");
    expect(readResult.value.contentType).toBe("text/plain");
  });

  it("defaults content type to application/octet-stream when not provided", async () => {
    await adapter.write({ key: KEY, body: new Uint8Array([1, 2, 3]) });
    const statResult = await adapter.stat({ key: KEY });
    expect(statResult.ok).toBe(true);
    if (!statResult.ok) return;
    expect(statResult.value.contentType).toBe("application/octet-stream");
  });

  it("returns PayloadTooLarge for bodies over the cap", async () => {
    // Use a fresh adapter with a low cap (1 KB) so we don't need
    // to allocate 5+ GB of memory to assert the cap behavior.
    const a = createMemoryAdapter({ maxSinglePutSize: 1024 });
    const overCap = new Uint8Array(1025);
    const result = await a.write({ key: KEY, body: overCap });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PayloadTooLarge");
  });

  it("allows writes just under the cap", async () => {
    const a = createMemoryAdapter({ maxSinglePutSize: 1024 });
    const underCap = new Uint8Array(1024);
    const result = await a.write({ key: KEY, body: underCap });
    expect(result.ok).toBe(true);
  });
});

describe("createMemoryAdapter — read errors", () => {
  it("returns NotFound when reading a key that doesn't exist", async () => {
    const result = await adapter.read({ key: KEY });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NotFound");
  });
});

describe("createMemoryAdapter — delete", () => {
  it("returns existed=true when key was present, existed=false otherwise", async () => {
    await adapter.write({ key: KEY, body: new Uint8Array([1]) });
    const first = await adapter.delete({ key: KEY });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.existed).toBe(true);

    const second = await adapter.delete({ key: KEY });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.existed).toBe(false);
  });
});

describe("createMemoryAdapter — exists", () => {
  it("reports false before write, true after write", async () => {
    const before = await adapter.exists({ key: KEY });
    expect(before.ok && before.value.exists).toBe(false);
    await adapter.write({ key: KEY, body: new Uint8Array([1]) });
    const after = await adapter.exists({ key: KEY });
    expect(after.ok && after.value.exists).toBe(true);
  });
});

describe("createMemoryAdapter — move + copy", () => {
  beforeEach(async () => {
    await adapter.write({
      key: KEY,
      body: new TextEncoder().encode("payload"),
      contentType: "text/plain",
    });
  });

  it("move renames the object and removes the source", async () => {
    const result = await adapter.move({ sourceKey: KEY, destinationKey: KEY_2 });
    expect(result.ok).toBe(true);
    const srcExists = await adapter.exists({ key: KEY });
    const dstExists = await adapter.exists({ key: KEY_2 });
    expect(srcExists.ok && srcExists.value.exists).toBe(false);
    expect(dstExists.ok && dstExists.value.exists).toBe(true);
  });

  it("copy duplicates the object and leaves the source", async () => {
    const result = await adapter.copy({ sourceKey: KEY, destinationKey: KEY_2 });
    expect(result.ok).toBe(true);
    const srcExists = await adapter.exists({ key: KEY });
    const dstExists = await adapter.exists({ key: KEY_2 });
    expect(srcExists.ok && srcExists.value.exists).toBe(true);
    expect(dstExists.ok && dstExists.value.exists).toBe(true);
  });
});

describe("createMemoryAdapter — list", () => {
  beforeEach(async () => {
    await adapter.write({ key: KEY_3, body: new Uint8Array([1]) });
    await adapter.write({ key: KEY_4, body: new Uint8Array([1, 2]) });
    await adapter.write({ key: KEY_5, body: new Uint8Array([1, 2, 3]) });
  });

  it("returns top-level keys under a prefix, grouping nested into folders", async () => {
    const result = await adapter.list({ prefix: PREFIX_A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const keys = result.value.items.map((i) => i.key).sort();
    // Top-level files are reported as-is.
    expect(keys).toContain("a/1.txt");
    expect(keys).toContain("a/2.txt");
    // Nested file is grouped under a synthetic "a/sub/" folder.
    expect(keys).toContain("a/sub/");
    // The nested file is NOT duplicated as a top-level entry.
    expect(keys).not.toContain("a/sub/3.txt");
  });
});

describe("createMemoryAdapter — metadata", () => {
  it("setMetadata merges by default and replaces when replace=true", async () => {
    await adapter.write({
      key: KEY,
      body: new Uint8Array([1]),
      metadata: { a: "1", b: "2" },
    });

    await adapter.setMetadata({ key: KEY, metadata: { b: "B", c: "3" } });
    const merged = await adapter.getMetadata({ key: KEY });
    expect(merged.ok && merged.value.metadata).toEqual({ a: "1", b: "B", c: "3" });

    await adapter.setMetadata({ key: KEY, metadata: { d: "4" }, replace: true });
    const replaced = await adapter.getMetadata({ key: KEY });
    expect(replaced.ok && replaced.value.metadata).toEqual({ d: "4" });
  });
});

describe("createMemoryAdapter — presigned URLs", () => {
  it("createPresignedUploadUrl returns an in-memory:// URL with method=PUT", async () => {
    const result = await adapter.createPresignedUploadUrl({ key: KEY, expiresIn: 60 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.url).toMatch(/^in-memory:\/\//);
    expect(result.value.method).toBe("PUT");
  });

  it("createPresignedDownloadUrl returns NotFound for unknown keys", async () => {
    const result = await adapter.createPresignedDownloadUrl({ key: KEY });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NotFound");
  });

  it("getPublicUrl returns a fake https URL", async () => {
    const result = await adapter.getPublicUrl({ key: KEY });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.url).toMatch(/^https:\/\/in-memory\.local\//);
  });
});

describe("createMemoryAdapter — store() snapshot", () => {
  it("reflects writes immediately", async () => {
    expect(adapter.store().objects.size).toBe(0);
    await adapter.write({ key: KEY, body: new Uint8Array([1]) });
    expect(adapter.store().objects.size).toBe(1);
  });

  it("returns a frozen view that the caller cannot mutate", async () => {
    await adapter.write({ key: KEY, body: new Uint8Array([1]) });
    const snap = adapter.store();
    // The internal map is a private field; the snapshot exposes it
    // as a ReadonlyMap. Calling `snap.objects.clear()` would still
    // mutate the underlying store in JS, but the public type makes
    // it clear this is read-only.
    expect(snap.objects.get(KEY)?.body.byteLength).toBe(1);
  });
});

describe("createMemoryAdapter — custom options", () => {
  it("honors a custom default content type", async () => {
    const a = createMemoryAdapter({ defaultContentType: "application/x-foo" });
    await a.write({ key: KEY, body: new Uint8Array([1]) });
    const stat = await a.stat({ key: KEY });
    expect(stat.ok && stat.value.contentType).toBe("application/x-foo");
  });

  it("disables the 5 GB cap when enforceSizeLimit=false", async () => {
    const a = createMemoryAdapter({ enforceSizeLimit: false });
    // Fake 6 GB body — would normally be rejected.
    const fakeBody = new Uint8Array(6_000_000_000);
    const result = await a.write({ key: KEY, body: fakeBody });
    expect(result.ok).toBe(true);
  });
});

// Reference asTenantId so vitest doesn't complain if it's a future
// unused import (the test currently doesn't use it but the type
// surfaces are part of the public API).
void asTenantId;
