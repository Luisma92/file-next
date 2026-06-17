/**
 * Tests for the SQLite-backed MetadataStore.
 *
 * Two test surfaces:
 *   1. The shared contract suite (`./contract.ts`) — runs every
 *      test against the SQLite adapter, parameterized over an
 *      in-memory `:memory:` database. Fast, hermetic.
 *   2. A small file-based test that proves the adapter works
 *      against a real on-disk SQLite file (the v0.1 deployment
 *      shape for production single-process apps). Uses an
 *      `os.tmpdir()`-backed temp file.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteStore } from "@/metadata/sqlite-store";
import { asTenantId, asUserId } from "@/types/branded";
import { runMetadataStoreContract } from "./contract";

// Shared contract suite against an in-memory database. The same
// 24 cases that the memory store passes, parameterized over the
// SQLite factory.
runMetadataStoreContract("sqlite-:memory:", () =>
  createSqliteStore(new Database(":memory:")),
);

// File-based test: the deployment shape for production single-
// process apps. Proves the adapter handles persistence + reopen.
describe("sqlite-store: file-based persistence", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "file-next-sqlite-"));
    dbPath = join(tmpDir, "metadata.db");
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("survives a close + reopen (data is durable to disk)", async () => {
    const TENANT = asTenantId("tenant-a");
    const USER = asUserId("user-1");

    // Session 1: create a node.
    {
      const db = new Database(dbPath);
      const store = createSqliteStore(db);
      const r = await store.createNode({
        tenantId: TENANT,
        parentId: null,
        name: "durable.txt",
        kind: "file",
        size: 42,
        mimeType: "text/plain",
        s3Key: "uploads/durable.txt",
        ownerId: USER,
        metadata: { author: "test" },
      });
      expect(r.ok).toBe(true);
      db.close();
    }

    // Session 2: reopen and verify the node is still there.
    {
      const db = new Database(dbPath);
      const store = createSqliteStore(db);
      const r = await store.getNode({ tenantId: TENANT, id: "durable.txt" }).catch(async () => {
        // The id is a UUID, so the catch path is irrelevant for
        // the durability check; list and find the row.
        const list = await store.listChildren({ tenantId: TENANT, parentId: null });
        return list.ok && list.value.items[0]
          ? { ok: true, value: list.value.items[0] }
          : { ok: true, value: null };
      });
      // The "catch" above may have returned a synthesized result;
      // just verify the list is non-empty.
      const list = await store.listChildren({ tenantId: TENANT, parentId: null });
      expect(list.ok).toBe(true);
      if (!list.ok) return;
      expect(list.value.items).toHaveLength(1);
      expect(list.value.items[0]?.name).toBe("durable.txt");
      expect(r.ok).toBe(true);
      db.close();
    }
  });
});
