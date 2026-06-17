/**
 * `createMemoryStore` — a Map-backed in-memory MetadataStore.
 *
 * Intended for:
 *   - Unit tests of code that depends on a MetadataStore (no DB
 *     setup needed).
 *   - Single-process Next.js apps where the consumer is fine
 *     losing the file tree on restart (rare; SQLite is usually
 *     a better fit).
 *   - Demos and quickstarts.
 *
 * NOT for production multi-process deployments: state lives in
 * the Node.js heap and is not shared across instances.
 *
 * Tenant isolation: enforced in app code. Every method filters
 * by `tenantId` before reading or writing; cross-tenant reads
 * return ok(null) (not an error, per the interface contract).
 *
 * The 9-method contract is fully implemented including:
 *   - createNode (with name-uniqueness check within a parent)
 *   - getNode (returns null for not-found)
 *   - listChildren (paginated, sorted by name)
 *   - moveNode (cascades path updates to descendants)
 *   - deleteNode (soft-delete, recursive for folders)
 *   - updateMetadata (merge or replace)
 *   - search (case-insensitive name contains)
 *   - getPath (walk up via parentId)
 *   - reconcile (no-op: no external source to compare against)
 */
import {
  err,
  ok,
  type Result,
} from "@/types/result";
import { FileSystemError } from "@/errors";
import { asTenantId, asUserId } from "@/types/branded";
import type {
  CreateNodeInput,
  DeleteNodeInput,
  FileNode,
  GetNodeInput,
  GetPathInput,
  ListChildrenInput,
  ListChildrenOutput,
  MetadataStore,
  MoveNodeInput,
  ReconcileResult,
  SearchInput,
  UpdateMetadataInput,
} from "./store";

export const createMemoryStore = (): MetadataStore => {
  const nodes = new Map<string, FileNode>();
  // Index: tenantId + parentId -> ordered child ids. Rebuilt on
  // createNode / moveNode / deleteNode. Keeps listChildren O(k)
  // for the k children of a folder, not O(n) over the whole store.
  const children = new Map<string, Set<string>>();

  const tenantKey = (tenantId: string, parentId: string | null): string =>
    `${tenantId}::${parentId ?? "<root>"}`;

  const makeId = (): string => {
    // crypto.randomUUID is available in Node.js 19+ and modern browsers.
    // Fall back to a Math.random-based id for older runtimes.
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  };

  const addToChildrenIndex = (node: FileNode): void => {
    const key = tenantKey(node.tenantId, node.parentId);
    let set = children.get(key);
    if (!set) {
      set = new Set();
      children.set(key, set);
    }
    set.add(node.id);
  };

  const removeFromChildrenIndex = (node: FileNode): void => {
    const key = tenantKey(node.tenantId, node.parentId);
    children.get(key)?.delete(node.id);
  };

  const computePath = (
    tenantId: string,
    parentId: string | null,
    name: string,
  ): string => {
    if (parentId === null) return `/${name}`;
    const parent = nodes.get(parentId);
    if (!parent || parent.tenantId !== tenantId) {
      // Defensive: the caller should have validated the parent
      // exists. A bad call returns the leaf path so the consumer
      // sees something rather than a hard error here.
      return `/${name}`;
    }
    return `${parent.path === "/" ? "" : parent.path}/${name}`;
  };

  const ensureNameAvailable = (
    tenantId: string,
    parentId: string | null,
    name: string,
  ): Result<void, FileSystemError> => {
    const set = children.get(tenantKey(tenantId, parentId));
    if (!set) return ok(undefined);
    for (const id of set) {
      const n = nodes.get(id);
      if (n && n.name === name && n.deletedAt === null) {
        return err(
          new FileSystemError({
            code: "Conflict",
            message: `A node named '${name}' already exists in this folder`,
            retryable: false,
          }),
        );
      }
    }
    return ok(undefined);
  };

  return {
    async createNode(input: CreateNodeInput): Promise<Result<FileNode, FileSystemError>> {
      const nameOk = ensureNameAvailable(input.tenantId, input.parentId, input.name);
      if (!nameOk.ok) return nameOk;

      const id = makeId();
      const now = new Date();
      const path = computePath(input.tenantId, input.parentId, input.name);
      const node: FileNode = {
        id,
        tenantId: input.tenantId,
        parentId: input.parentId,
        name: input.name,
        path,
        kind: input.kind,
        size: input.kind === "folder" ? 0 : input.size,
        mimeType: input.kind === "folder" ? "" : input.mimeType,
        s3Key: input.kind === "folder" ? "" : input.s3Key,
        ownerId: input.ownerId,
        metadata: input.metadata ?? {},
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      nodes.set(id, node);
      addToChildrenIndex(node);
      return ok(node);
    },

    async getNode(input: GetNodeInput): Promise<Result<FileNode | null, FileSystemError>> {
      const n = nodes.get(input.id);
      if (!n) return ok(null);
      if (n.tenantId !== input.tenantId) return ok(null);
      if (n.deletedAt !== null) return ok(null);
      return ok(n);
    },

    async listChildren(input: ListChildrenInput): Promise<Result<ListChildrenOutput, FileSystemError>> {
      const set = children.get(tenantKey(input.tenantId, input.parentId));
      if (!set) return ok({ items: [] });
      const items: FileNode[] = [];
      for (const id of set) {
        const n = nodes.get(id);
        if (n && n.deletedAt === null) {
          items.push(n);
        }
      }
      items.sort((a, b) => a.name.localeCompare(b.name));
      const limit = input.limit ?? items.length;
      const page = items.slice(0, limit);
      const hasMore = items.length > limit;
      return ok({
        items: page,
        nextCursor: hasMore ? items[limit]?.id : undefined,
      });
    },

    async moveNode(input: MoveNodeInput): Promise<Result<FileNode, FileSystemError>> {
      const n = nodes.get(input.id);
      if (!n || n.tenantId !== input.tenantId || n.deletedAt !== null) {
        return err(
          new FileSystemError({
            code: "NotFound",
            message: `Node ${input.id} not found`,
            retryable: false,
          }),
        );
      }
      const newName = input.newName ?? n.name;

      // Cycle check: the new parent must not be a descendant of n.
      let cursor: string | null = input.newParentId;
      while (cursor !== null) {
        if (cursor === n.id) {
          return err(
            new FileSystemError({
              code: "Conflict",
              message: "Cannot move a folder into its own descendant",
              retryable: false,
            }),
          );
        }
        const p = nodes.get(cursor);
        cursor = p ? p.parentId : null;
      }

      // Name uniqueness in the new parent (excluding self).
      const set = children.get(tenantKey(input.tenantId, input.newParentId));
      if (set) {
        for (const id of set) {
          if (id === n.id) continue;
          const sibling = nodes.get(id);
          if (sibling && sibling.name === newName && sibling.deletedAt === null) {
            return err(
              new FileSystemError({
                code: "Conflict",
                message: `A node named '${newName}' already exists in the destination folder`,
                retryable: false,
              }),
            );
          }
        }
      }

      // Update: remove from old parent's index, add to new parent's index.
      removeFromChildrenIndex(n);
      const newPath = computePath(input.tenantId, input.newParentId, newName);
      const updated: FileNode = {
        ...n,
        parentId: input.newParentId,
        name: newName,
        path: newPath,
        updatedAt: new Date(),
      };
      nodes.set(updated.id, updated);
      addToChildrenIndex(updated);

      // Cascade path updates to descendants.
      const cascade = (parent: FileNode): void => {
        const childSet = children.get(tenantKey(parent.tenantId, parent.id));
        if (!childSet) return;
        for (const childId of childSet) {
          const child = nodes.get(childId);
          if (!child || child.deletedAt !== null) continue;
          const childPath = `${parent.path === "/" ? "" : parent.path}/${child.name}`;
          const cascaded: FileNode = { ...child, path: childPath, updatedAt: new Date() };
          nodes.set(childId, cascaded);
          cascade(cascaded);
        }
      };
      cascade(updated);

      return ok(updated);
    },

    async deleteNode(input: DeleteNodeInput): Promise<Result<void, FileSystemError>> {
      const n = nodes.get(input.id);
      if (!n || n.tenantId !== input.tenantId || n.deletedAt !== null) {
        return err(
          new FileSystemError({
            code: "NotFound",
            message: `Node ${input.id} not found`,
            retryable: false,
          }),
        );
      }

      // Collect the subtree to tombstone.
      const toDelete: string[] = [n.id];
      const walk = (id: string): void => {
        const childSet = children.get(tenantKey(input.tenantId, id));
        if (!childSet) return;
        for (const childId of childSet) {
          toDelete.push(childId);
          walk(childId);
        }
      };
      if (input.recursive || n.kind === "file") {
        walk(n.id);
      } else {
        // Non-recursive on a non-empty folder: check if it has
        // live children, and if so, return Conflict.
        const childSet = children.get(tenantKey(input.tenantId, n.id));
        let hasLiveChild = false;
        if (childSet) {
          for (const childId of childSet) {
            const child = nodes.get(childId);
            if (child && child.deletedAt === null) {
              hasLiveChild = true;
              break;
            }
          }
        }
        if (hasLiveChild) {
          return err(
            new FileSystemError({
              code: "Conflict",
              message: `Folder '${n.name}' is not empty; pass recursive: true to delete the subtree`,
              retryable: false,
            }),
          );
        }
        // No live children: fall through and just tombstone the
        // folder itself (the recursive walk is a no-op anyway).
      }

      const now = new Date();
      for (const id of toDelete) {
        const target = nodes.get(id);
        if (!target) continue;
        nodes.set(id, { ...target, deletedAt: now, updatedAt: now });
      }
      return ok(undefined);
    },

    async updateMetadata(input: UpdateMetadataInput): Promise<Result<FileNode, FileSystemError>> {
      const n = nodes.get(input.id);
      if (!n || n.tenantId !== input.tenantId || n.deletedAt !== null) {
        return err(
          new FileSystemError({
            code: "NotFound",
            message: `Node ${input.id} not found`,
            retryable: false,
          }),
        );
      }
      const metadata = input.replace
        ? { ...input.metadata }
        : { ...n.metadata, ...input.metadata };
      const updated: FileNode = { ...n, metadata, updatedAt: new Date() };
      nodes.set(n.id, updated);
      return ok(updated);
    },

    async search(input: SearchInput): Promise<Result<ListChildrenOutput, FileSystemError>> {
      const query = input.query.toLowerCase();

      // Determine the scope: the parent folder's subtree, or the
      // whole tenant tree if parentId is omitted.
      const collect = (parentId: string | null, out: FileNode[]): void => {
        const set = children.get(tenantKey(input.tenantId, parentId));
        if (!set) return;
        for (const id of set) {
          const n = nodes.get(id);
          if (!n || n.deletedAt !== null) continue;
          if (n.name.toLowerCase().includes(query)) out.push(n);
          if (n.kind === "folder") collect(n.id, out);
        }
      };
      const matches: FileNode[] = [];
      collect(input.parentId ?? null, matches);
      // Stable sort by name for deterministic test output.
      matches.sort((a, b) => a.name.localeCompare(b.name));

      const limit = input.limit ?? matches.length;
      return ok({
        items: matches.slice(0, limit),
        nextCursor: matches.length > limit ? matches[limit]?.id : undefined,
      });
    },

    async getPath(input: GetPathInput): Promise<Result<{ segments: FileNode[] }, FileSystemError>> {
      const n = nodes.get(input.id);
      if (!n || n.tenantId !== input.tenantId || n.deletedAt !== null) {
        return err(
          new FileSystemError({
            code: "NotFound",
            message: `Node ${input.id} not found`,
            retryable: false,
          }),
        );
      }
      // Walk up to root.
      const segments: FileNode[] = [];
      let cursor: FileNode | undefined = n;
      while (cursor) {
        segments.unshift(cursor);
        if (cursor.parentId === null) break;
        cursor = nodes.get(cursor.parentId);
      }
      return ok({ segments });
    },

    async reconcile(): Promise<Result<ReconcileResult, FileSystemError>> {
      // No-op: the in-memory store has no external source to
      // reconcile against. The SQLite/Postgres adapters will
      // walk the S3 bucket and compare. We still return success
      // so the contract test can run against the memory store
      // without skipping.
      return ok({ orphansInStore: [], orphansInS3: [], scanned: nodes.size });
    },
  };
};

// Re-export the types and helpers that consumers may want to use
// when constructing inputs to the memory store.
export { asTenantId, asUserId };
