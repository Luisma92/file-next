/**
 * Tests for the in-memory MetadataStore.
 *
 * The 9-method contract is fully implemented; these tests cover
 * every method including the cross-cutting concerns (tenant
 * isolation, soft-delete, path cascade on move, name uniqueness).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore, type MetadataStore, type FileNode } from "@/metadata";
import { asTenantId, asUserId } from "@/types/branded";
import { FileSystemError } from "@/errors";

const TENANT_A = asTenantId("tenant-a");
const TENANT_B = asTenantId("tenant-b");
const USER_1 = asUserId("user-1");

let store: MetadataStore;

beforeEach(() => {
  store = createMemoryStore();
});

const makeFileInput = (overrides: Partial<Parameters<MetadataStore["createNode"]>[0]> = {}) => ({
  tenantId: TENANT_A,
  parentId: null,
  name: "doc.txt",
  kind: "file" as const,
  size: 100,
  mimeType: "text/plain",
  s3Key: "uploads/doc.txt",
  ownerId: USER_1,
  metadata: {},
  ...overrides,
});

// ---------------------------------------------------------------------------
// createNode + getNode
// ---------------------------------------------------------------------------

describe("T-026/T-027: createNode + getNode", () => {
  it("createNode creates a file node with materialized path", async () => {
    const r = await store.createNode(makeFileInput({ name: "a.txt" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe("a.txt");
    expect(r.value.path).toBe("/a.txt");
    expect(r.value.kind).toBe("file");
    expect(r.value.size).toBe(100);
    expect(r.value.deletedAt).toBeNull();
  });

  it("getNode returns the node by id", async () => {
    const c = await store.createNode(makeFileInput());
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const g = await store.getNode({ tenantId: TENANT_A, id: c.value.id });
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.value?.id).toBe(c.value.id);
  });

  it("getNode returns null for missing id (NOT NotFound)", async () => {
    const g = await store.getNode({ tenantId: TENANT_A, id: "nope" });
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.value).toBeNull();
  });

  it("createNode rejects duplicate (parentId, name) with Conflict", async () => {
    await store.createNode(makeFileInput({ name: "x.txt" }));
    const r = await store.createNode(makeFileInput({ name: "x.txt" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("Conflict");
  });

  it("tenant isolation: getNode with the wrong tenantId returns null", async () => {
    const c = await store.createNode(makeFileInput({ name: "secret.txt" }));
    if (!c.ok) throw new Error("create failed");
    const g = await store.getNode({ tenantId: TENANT_B, id: c.value.id });
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listChildren
// ---------------------------------------------------------------------------

describe("T-026: listChildren", () => {
  it("lists children of the root, sorted by name", async () => {
    await store.createNode(makeFileInput({ name: "b.txt" }));
    await store.createNode(makeFileInput({ name: "a.txt" }));
    await store.createNode(makeFileInput({ name: "c.txt" }));
    const r = await store.listChildren({ tenantId: TENANT_A, parentId: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((n) => n.name)).toEqual(["a.txt", "b.txt", "c.txt"]);
  });

  it("respects parentId scoping", async () => {
    const folder = await store.createNode(
      makeFileInput({ name: "folder", kind: "folder", size: 0, mimeType: "", s3Key: "" }),
    );
    if (!folder.ok) throw new Error("create failed");
    await store.createNode(makeFileInput({ name: "in.txt", parentId: folder.value.id }));
    await store.createNode(makeFileInput({ name: "out.txt", parentId: null }));

    const inFolder = await store.listChildren({ tenantId: TENANT_A, parentId: folder.value.id });
    expect(inFolder.ok).toBe(true);
    if (!inFolder.ok) return;
    expect(inFolder.value.items.map((n) => n.name)).toEqual(["in.txt"]);

    const atRoot = await store.listChildren({ tenantId: TENANT_A, parentId: null });
    expect(atRoot.ok).toBe(true);
    if (!atRoot.ok) return;
    expect(atRoot.value.items.map((n) => n.name)).toEqual(["folder", "out.txt"]);
  });

  it("paginates with limit and nextCursor", async () => {
    for (let i = 0; i < 5; i++) {
      await store.createNode(makeFileInput({ name: `f-${i}.txt` }));
    }
    const r = await store.listChildren({ tenantId: TENANT_A, parentId: null, limit: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items).toHaveLength(2);
    expect(r.value.nextCursor).toBeDefined();
  });

  it("excludes soft-deleted nodes", async () => {
    const a = await store.createNode(makeFileInput({ name: "a.txt" }));
    if (!a.ok) throw new Error("create failed");
    await store.createNode(makeFileInput({ name: "b.txt" }));
    await store.deleteNode({ tenantId: TENANT_A, id: a.value.id });

    const r = await store.listChildren({ tenantId: TENANT_A, parentId: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((n) => n.name)).toEqual(["b.txt"]);
  });

  it("tenant isolation: listChildren with the wrong tenantId returns empty", async () => {
    await store.createNode(makeFileInput({ name: "a.txt" }));
    const r = await store.listChildren({ tenantId: TENANT_B, parentId: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// moveNode — including the path cascade
// ---------------------------------------------------------------------------

describe("T-026: moveNode", () => {
  it("moves a file to a new parent and updates the path", async () => {
    const folder = await store.createNode(
      makeFileInput({ name: "dest", kind: "folder", size: 0, mimeType: "", s3Key: "" }),
    );
    if (!folder.ok) throw new Error("create failed");
    const file = await store.createNode(makeFileInput({ name: "x.txt" }));
    if (!file.ok) throw new Error("create failed");

    const r = await store.moveNode({
      tenantId: TENANT_A,
      id: file.value.id,
      newParentId: folder.value.id,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.path).toBe("/dest/x.txt");
  });

  it("renames a node in place when newParentId is omitted (null)", async () => {
    const file = await store.createNode(makeFileInput({ name: "old.txt" }));
    if (!file.ok) throw new Error("create failed");
    const r = await store.moveNode({
      tenantId: TENANT_A,
      id: file.value.id,
      newParentId: null,
      newName: "new.txt",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe("new.txt");
    expect(r.value.path).toBe("/new.txt");
  });

  it("cascade: moving a folder updates descendants' paths", async () => {
    const folder = await store.createNode(
      makeFileInput({ name: "f", kind: "folder", size: 0, mimeType: "", s3Key: "" }),
    );
    if (!folder.ok) throw new Error("create failed");
    const child = await store.createNode(
      makeFileInput({ name: "c.txt", parentId: folder.value.id }),
    );
    if (!child.ok) throw new Error("create failed");
    const grandchild = await store.createNode(
      makeFileInput({ name: "g.txt", parentId: child.value.id }),
    );
    if (!grandchild.ok) throw new Error("create failed");

    const dest = await store.createNode(
      makeFileInput({ name: "dest", kind: "folder", size: 0, mimeType: "", s3Key: "" }),
    );
    if (!dest.ok) throw new Error("create failed");

    await store.moveNode({ tenantId: TENANT_A, id: folder.value.id, newParentId: dest.value.id });

    const c = await store.getNode({ tenantId: TENANT_A, id: child.value.id });
    const g = await store.getNode({ tenantId: TENANT_A, id: grandchild.value.id });
    expect(c.ok && c.value).toBeTruthy();
    expect(g.ok && g.value).toBeTruthy();
    if (c.ok && c.value) expect(c.value.path).toBe("/dest/f/c.txt");
    if (g.ok && g.value) expect(g.value.path).toBe("/dest/f/c.txt/g.txt");
  });

  it("rejects moving a folder into its own descendant (cycle)", async () => {
    const folder = await store.createNode(
      makeFileInput({ name: "f", kind: "folder", size: 0, mimeType: "", s3Key: "" }),
    );
    if (!folder.ok) throw new Error("create failed");
    const child = await store.createNode(
      makeFileInput({ name: "c", kind: "folder", parentId: folder.value.id, size: 0, mimeType: "", s3Key: "" }),
    );
    if (!child.ok) throw new Error("create failed");
    const r = await store.moveNode({ tenantId: TENANT_A, id: folder.value.id, newParentId: child.value.id });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("Conflict");
  });

  it("rejects move that would create a name collision", async () => {
    const folder = await store.createNode(
      makeFileInput({ name: "f", kind: "folder", size: 0, mimeType: "", s3Key: "" }),
    );
    if (!folder.ok) throw new Error("create failed");
    await store.createNode(makeFileInput({ name: "x.txt", parentId: folder.value.id }));
    const other = await store.createNode(makeFileInput({ name: "other.txt" }));
    if (!other.ok) throw new Error("create failed");

    const r = await store.moveNode({ tenantId: TENANT_A, id: other.value.id, newParentId: folder.value.id, newName: "x.txt" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("Conflict");
  });
});

// ---------------------------------------------------------------------------
// deleteNode — soft delete with recursive
// ---------------------------------------------------------------------------

describe("T-026: deleteNode", () => {
  it("soft-deletes a file (sets deletedAt, keeps the row)", async () => {
    const f = await store.createNode(makeFileInput());
    if (!f.ok) throw new Error("create failed");
    const d = await store.deleteNode({ tenantId: TENANT_A, id: f.value.id });
    expect(d.ok).toBe(true);
    const g = await store.getNode({ tenantId: TENANT_A, id: f.value.id });
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.value).toBeNull();
  });

  it("non-recursive on a non-empty folder returns Conflict", async () => {
    const folder = await store.createNode(
      makeFileInput({ name: "f", kind: "folder", size: 0, mimeType: "", s3Key: "" }),
    );
    if (!folder.ok) throw new Error("create failed");
    await store.createNode(makeFileInput({ name: "c.txt", parentId: folder.value.id }));

    const r = await store.deleteNode({ tenantId: TENANT_A, id: folder.value.id });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("Conflict");
  });

  it("recursive=true tombstones the entire subtree", async () => {
    const folder = await store.createNode(
      makeFileInput({ name: "f", kind: "folder", size: 0, mimeType: "", s3Key: "" }),
    );
    if (!folder.ok) throw new Error("create failed");
    const child = await store.createNode(
      makeFileInput({ name: "c.txt", parentId: folder.value.id }),
    );
    if (!child.ok) throw new Error("create failed");
    const grand = await store.createNode(
      makeFileInput({ name: "g.txt", parentId: child.value.id }),
    );
    if (!grand.ok) throw new Error("create failed");

    const r = await store.deleteNode({ tenantId: TENANT_A, id: folder.value.id, recursive: true });
    expect(r.ok).toBe(true);

    const c = await store.getNode({ tenantId: TENANT_A, id: child.value.id });
    const g = await store.getNode({ tenantId: TENANT_A, id: grand.value.id });
    expect(c.ok && c.value).toBeNull();
    expect(g.ok && g.value).toBeNull();
  });

  it("non-recursive on an empty folder succeeds (tombstones just the folder)", async () => {
    const folder = await store.createNode(
      makeFileInput({ name: "f", kind: "folder", size: 0, mimeType: "", s3Key: "" }),
    );
    if (!folder.ok) throw new Error("create failed");
    const r = await store.deleteNode({ tenantId: TENANT_A, id: folder.value.id });
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateMetadata
// ---------------------------------------------------------------------------

describe("T-026: updateMetadata", () => {
  it("merges by default", async () => {
    const f = await store.createNode(makeFileInput({ metadata: { a: "1" } }));
    if (!f.ok) throw new Error("create failed");
    const r = await store.updateMetadata({ tenantId: TENANT_A, id: f.value.id, metadata: { b: "2" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.metadata).toEqual({ a: "1", b: "2" });
  });

  it("replace: true replaces the whole map", async () => {
    const f = await store.createNode(makeFileInput({ metadata: { a: "1", b: "2" } }));
    if (!f.ok) throw new Error("create failed");
    const r = await store.updateMetadata({
      tenantId: TENANT_A,
      id: f.value.id,
      metadata: { c: "3" },
      replace: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.metadata).toEqual({ c: "3" });
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe("T-026: search", () => {
  it("finds matches by case-insensitive substring on the name", async () => {
    await store.createNode(makeFileInput({ name: "Report.pdf" }));
    await store.createNode(makeFileInput({ name: "report-draft.pdf" }));
    await store.createNode(makeFileInput({ name: "unrelated.txt" }));
    const r = await store.search({ tenantId: TENANT_A, query: "REPORT" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((n) => n.name).sort()).toEqual(["Report.pdf", "report-draft.pdf"]);
  });

  it("scopes to a parent subtree when parentId is given", async () => {
    const folder = await store.createNode(
      makeFileInput({ name: "f", kind: "folder", size: 0, mimeType: "", s3Key: "" }),
    );
    if (!folder.ok) throw new Error("create failed");
    await store.createNode(makeFileInput({ name: "match.txt", parentId: folder.value.id }));
    await store.createNode(makeFileInput({ name: "match-outside.txt" }));

    const r = await store.search({ tenantId: TENANT_A, query: "match", parentId: folder.value.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((n) => n.name)).toEqual(["match.txt"]);
  });

  it("tenant isolation: searches only return the tenant's nodes", async () => {
    await store.createNode(makeFileInput({ name: "shared.txt", tenantId: TENANT_A }));
    await store.createNode(makeFileInput({ name: "shared.txt", tenantId: TENANT_B }));
    const a = await store.search({ tenantId: TENANT_A, query: "shared" });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.value.items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getPath
// ---------------------------------------------------------------------------

describe("T-026: getPath", () => {
  it("walks the parent chain from root to the target", async () => {
    const root = await store.createNode(
      makeFileInput({ name: "uploads", kind: "folder", size: 0, mimeType: "", s3Key: "" }),
    );
    if (!root.ok) throw new Error("create failed");
    const sub = await store.createNode(
      makeFileInput({ name: "2024", kind: "folder", parentId: root.value.id, size: 0, mimeType: "", s3Key: "" }),
    );
    if (!sub.ok) throw new Error("create failed");
    const file = await store.createNode(
      makeFileInput({ name: "photo.jpg", parentId: sub.value.id, size: 0, mimeType: "image/jpeg", s3Key: "uploads/2024/photo.jpg" }),
    );
    if (!file.ok) throw new Error("create failed");

    const r = await store.getPath({ tenantId: TENANT_A, id: file.value.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.segments.map((n) => n.name)).toEqual(["uploads", "2024", "photo.jpg"]);
  });
});

// ---------------------------------------------------------------------------
// reconcile
// ---------------------------------------------------------------------------

describe("T-026: reconcile", () => {
  it("returns a no-op result (no external source to compare against)", async () => {
    await store.createNode(makeFileInput());
    await store.createNode(makeFileInput({ name: "b.txt" }));
    const r = await store.reconcile();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.scanned).toBe(2);
    expect(r.value.orphansInStore).toEqual([]);
    expect(r.value.orphansInS3).toEqual([]);
  });
});
