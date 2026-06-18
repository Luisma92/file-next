/**
 * Tests for the demo's `file-next` library wiring.
 *
 * Validates:
 *   - Singleton lazy initialization (singleton instance is reused).
 *   - End-to-end flow: list (empty) → create → list (1 file).
 *   - Reset helper clears all singletons (for test isolation).
 *
 * Note: this test runs in the root vitest workspace (node env, no
 * DOM). It exercises the same code path the demo's home page
 * uses at request time.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  getActions,
  getAdapter,
  getStore,
  _resetForTests,
  DEMO_TENANT,
} from "../app/lib/file-next-store";

describe("demo file-next wiring", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("getActions returns the same singleton across calls", () => {
    const a = getActions();
    const b = getActions();
    expect(a).toBe(b);
  });

  it("getAdapter returns the same singleton across calls", () => {
    const a = getAdapter();
    const b = getAdapter();
    expect(a).toBe(b);
  });

  it("getStore returns the same singleton across calls", () => {
    const a = getStore();
    const b = getStore();
    expect(a).toBe(b);
  });

  it("starts with an empty file list", async () => {
    const actions = getActions();
    const res = await actions.listFiles({
      tenantId: DEMO_TENANT,
      parentId: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.items).toEqual([]);
  });

  it("listFiles returns Result<FileSystemError, ...> with the correct shape", async () => {
    const actions = getActions();
    const res = await actions.listFiles({
      tenantId: DEMO_TENANT,
      parentId: null,
    });
    // Discriminated union — narrow with `if (!res.ok) return;`.
    if (res.ok) {
      // value has the expected shape
      expect(Array.isArray(res.value.items)).toBe(true);
      expect(res.value).toHaveProperty("items");
    } else {
      // error has the expected shape
      expect(res.error).toHaveProperty("code");
      expect(res.error).toHaveProperty("message");
    }
  });

  it("write + read against the in-memory adapter round-trips", async () => {
    const adapter = getAdapter();
    const writeRes = await adapter.write({
      key: "test.txt" as unknown as Parameters<typeof adapter.write>[0]["key"],
      body: new TextEncoder().encode("hello"),
      contentType: "text/plain",
    });
    expect(writeRes.ok).toBe(true);
    if (!writeRes.ok) return;
    const readRes = await adapter.read({
      key: "test.txt" as unknown as Parameters<typeof adapter.read>[0]["key"],
    });
    expect(readRes.ok).toBe(true);
    if (!readRes.ok) return;
    expect(new TextDecoder().decode(readRes.value.body)).toBe("hello");
  });

  it("createNode + listChildren against the in-memory store round-trips", async () => {
    const store = getStore();
    const createRes = await store.createNode({
      tenantId: DEMO_TENANT,
      parentId: null,
      name: "test.txt",
      kind: "file",
      size: 5,
      mimeType: "text/plain",
      s3Key: "test.txt" as unknown as Parameters<typeof store.createNode>[0]["s3Key"],
      ownerId: "u-1" as unknown as Parameters<typeof store.createNode>[0]["ownerId"],
    });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;

    const listRes = await store.listChildren({
      tenantId: DEMO_TENANT,
      parentId: null,
    });
    expect(listRes.ok).toBe(true);
    if (!listRes.ok) return;
    expect(listRes.value.items).toHaveLength(1);
    expect(listRes.value.items[0]?.name).toBe("test.txt");
  });

  it("_resetForTests clears all singletons (next getActions returns a new instance)", () => {
    const a = getActions();
    _resetForTests();
    const b = getActions();
    expect(a).not.toBe(b);
  });
});
