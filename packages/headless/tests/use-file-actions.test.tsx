/**
 * Tests for the `useFileActions` hook.
 *
 * Scenarios (from spec `headless#3` — actions):
 *   - Optimistic update: snapshot before, apply immediately on
 *     success, restore on failure.
 *   - Errors surface as `FileSystemError` AND the file list reverts
 *     to the pre-mutation snapshot.
 *   - Three actions: deleteFile(id), moveFile(id, newParentId),
 *     copyFile(id, newParentId).
 *
 * The actions are mocked via plain `vi.fn()` callbacks that the
 * consumer would normally wrap around server actions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileActions } from "@/use-file-actions";
import { asTenantId, asUserId } from "file-next";
import type { FileNode, FileSystemError } from "file-next";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseTimestamp = new Date("2026-06-17T12:00:00Z");

const makeNode = (
  id: string,
  overrides: Partial<FileNode> = {},
): FileNode => ({
  id,
  tenantId: asTenantId("acme"),
  parentId: "root",
  name: `${id}.txt`,
  path: `/${id}.txt`,
  kind: "file",
  size: 100,
  mimeType: "text/plain",
  s3Key: `tenant/${id}.txt`,
  ownerId: asUserId("user-1"),
  metadata: {},
  createdAt: baseTimestamp,
  updatedAt: baseTimestamp,
  deletedAt: null,
  ...overrides,
});

const initialFiles: ReadonlyArray<FileNode> = [
  makeNode("a", { name: "alpha.txt" }),
  makeNode("b", { name: "beta.txt" }),
  makeNode("c", { name: "gamma.txt" }),
];

const okResult = <T,>(value: T) => ({ ok: true as const, value });
const errResult = (error: FileSystemError) => ({ ok: false as const, error });

const networkError = new (class extends Error {
  readonly code = "NetworkError";
  readonly retryable = true;
  constructor() {
    super("boom");
    this.name = "FileSystemError";
  }
})() as unknown as FileSystemError;

// ---------------------------------------------------------------------------
// Hook render helper
// ---------------------------------------------------------------------------

type Actions = {
  deleteFile: ReturnType<typeof vi.fn>;
  moveFile: ReturnType<typeof vi.fn>;
  copyFile: ReturnType<typeof vi.fn>;
};

const renderActions = (overrides: Partial<Actions> = {}) => {
  const files = [...initialFiles];
  const setFiles = vi.fn();
  const actions: Actions = {
    deleteFile: vi.fn(async () => okResult({ id: "x" })),
    moveFile: vi.fn(async () => okResult({ id: "x" })),
    copyFile: vi.fn(async () => okResult({ id: "x" })),
    ...overrides,
  };
  const result = renderHook(() =>
    useFileActions({ files, setFiles, actions }),
  );
  return { result, files, setFiles, actions };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useFileActions — spec headless#3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deleteFile optimistically removes the file and calls the action", async () => {
    const { result, files, setFiles, actions } = renderActions();
    await act(async () => {
      await result.current.deleteFile("a");
    });

    expect(actions.deleteFile).toHaveBeenCalledWith({ id: "a" });
    // Optimistic removal: setFiles called once with the 2 remaining files.
    expect(setFiles).toHaveBeenCalledTimes(1);
    const updated = setFiles.mock.calls[0][0] as ReadonlyArray<FileNode>;
    expect(updated.map((f) => f.id)).toEqual(["b", "c"]);
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("deleteFile restores the snapshot and surfaces the error on failure", async () => {
    const { result, files, setFiles, actions } = renderActions({
      deleteFile: vi.fn(async () => errResult(networkError)),
    });
    await act(async () => {
      await result.current.deleteFile("a");
    });

    // First setFiles call = optimistic removal (with 2 files).
    // Second setFiles call = rollback to original 3 files.
    expect(setFiles).toHaveBeenCalledTimes(2);
    const rolledBack = setFiles.mock.calls[1][0] as ReadonlyArray<FileNode>;
    expect(rolledBack).toBe(files); // strict identity: original array reference
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBe(networkError);
  });

  it("moveFile optimistically relocates the node to a new parent", async () => {
    const { result, setFiles, actions } = renderActions({
      moveFile: vi.fn(async () => okResult({ id: "a" })),
    });
    await act(async () => {
      await result.current.moveFile("a", "folder-2");
    });

    expect(actions.moveFile).toHaveBeenCalledWith({
      id: "a",
      newParentId: "folder-2",
    });
    expect(setFiles).toHaveBeenCalledTimes(1);
    const updated = setFiles.mock.calls[0][0] as ReadonlyArray<FileNode>;
    const moved = updated.find((f) => f.id === "a");
    expect(moved?.parentId).toBe("folder-2");
  });

  it("moveFile rolls back on failure", async () => {
    const { result, files, setFiles, actions } = renderActions({
      moveFile: vi.fn(async () => errResult(networkError)),
    });
    await act(async () => {
      await result.current.moveFile("a", "folder-2");
    });

    expect(setFiles).toHaveBeenCalledTimes(2);
    const rolledBack = setFiles.mock.calls[1][0] as ReadonlyArray<FileNode>;
    expect(rolledBack).toBe(files);
    expect(result.current.error).toBe(networkError);
  });

  it("copyFile creates a sibling node sharing the same s3Key", async () => {
    const newNode = makeNode("a-copy", {
      parentId: "folder-2",
      s3Key: "tenant/a.txt", // same source
    });
    const { result, setFiles, actions } = renderActions({
      copyFile: vi.fn(async () => okResult({ node: newNode })),
    });
    await act(async () => {
      await result.current.copyFile("a", "folder-2");
    });

    expect(actions.copyFile).toHaveBeenCalledWith({
      id: "a",
      newParentId: "folder-2",
    });
    expect(setFiles).toHaveBeenCalledTimes(1);
    const updated = setFiles.mock.calls[0][0] as ReadonlyArray<FileNode>;
    expect(updated).toHaveLength(4);
    expect(updated.map((f) => f.id)).toContain("a-copy");
  });

  it("copyFile rolls back on failure", async () => {
    const { result, files, setFiles } = renderActions({
      copyFile: vi.fn(async () => errResult(networkError)),
    });
    await act(async () => {
      await result.current.copyFile("a", "folder-2");
    });

    expect(setFiles).toHaveBeenCalledTimes(2);
    const rolledBack = setFiles.mock.calls[1][0] as ReadonlyArray<FileNode>;
    expect(rolledBack).toBe(files);
    expect(result.current.error).toBe(networkError);
  });

  it("isPending flips to true during the action and back to false after", async () => {
    let resolveDelete: (value: { ok: true; value: { id: string } }) => void = () => {};
    const { result } = renderActions({
      deleteFile: vi.fn(
        () =>
          new Promise<{ ok: true; value: { id: string } }>((resolve) => {
            resolveDelete = resolve;
          }),
      ),
    });

    // Start the deletion without awaiting.
    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.deleteFile("a");
    });
    // After the synchronous kick-off, isPending is true.
    expect(result.current.isPending).toBe(true);

    // Resolve the action; await the completion.
    await act(async () => {
      resolveDelete(okResult({ id: "a" }));
      await pending;
    });
    expect(result.current.isPending).toBe(false);
  });
});
