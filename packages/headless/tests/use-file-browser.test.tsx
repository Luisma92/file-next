/**
 * Tests for the `useFileBrowser` hook.
 *
 * Scenarios (from spec `headless#1`):
 *   - The hook must surface loading/empty/error states via useReducer.
 *   - On `refetch()` the hook transitions idle → loading → success|error.
 *   - A successful list with 3 items produces `{ status: 'success', files: [3] }`.
 *   - A successful empty list produces `{ status: 'success', files: [] }`.
 *   - A rejected listFiles callback produces `{ status: 'error', files: [], error: <FileSystemError> }`.
 *
 * The hook receives the `listFiles` callback as an injected dependency
 * (no direct import of `file-next/server`). This keeps the package
 * pure-client and trivially testable.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFileBrowser } from "@/use-file-browser";
import { FileSystemError } from "file-next";
import { asTenantId, type FileNode } from "file-next";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT = asTenantId("acme");

const makeFile = (overrides: Partial<FileNode> = {}): FileNode => ({
  id: "n-1",
  tenantId: TENANT,
  parentId: null,
  name: "a.txt",
  path: "/a.txt",
  kind: "file",
  size: 1,
  mimeType: "text/plain",
  s3Key: "a.txt",
  ownerId: "u-1" as never,
  metadata: {},
  createdAt: new Date(0),
  updatedAt: new Date(0),
  deletedAt: null,
  ...overrides,
});

describe("useFileBrowser — spec headless#1", () => {
  it("starts in the idle state and exposes a refetch handle", () => {
    const listFiles = vi.fn().mockResolvedValue({ ok: true as const, value: { items: [] as FileNode[] } });
    const { result } = renderHook(() =>
      useFileBrowser({ listFiles, parentId: null, tenantId: TENANT }),
    );
    expect(result.current.status).toBe("idle");
    expect(result.current.files).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.refetch).toBe("function");
    // No auto-fetch by default — the consumer drives the load.
    expect(listFiles).not.toHaveBeenCalled();
  });

  it("auto-fetches on mount when autoFetch: true", async () => {
    const listFiles = vi.fn().mockResolvedValue({ ok: true as const, value: { items: [makeFile({ id: "1" })] } });
    const { result } = renderHook(() =>
      useFileBrowser({ listFiles, parentId: null, tenantId: TENANT, autoFetch: true }),
    );
    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });
    expect(result.current.files).toHaveLength(1);
    expect(listFiles).toHaveBeenCalledTimes(1);
  });

  it("transitions idle → loading → success with 3 files when listFiles resolves", async () => {
    const files: FileNode[] = [makeFile({ id: "1" }), makeFile({ id: "2" }), makeFile({ id: "3" })];
    const listFiles = vi.fn().mockResolvedValue({ ok: true as const, value: { items: files } });
    const { result } = renderHook(() =>
      useFileBrowser({ listFiles, parentId: null, tenantId: TENANT }),
    );

    act(() => {
      void result.current.refetch();
    });
    // Synchronously after dispatch, the state must be loading
    expect(result.current.status).toBe("loading");
    expect(result.current.files).toEqual([]);

    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });
    expect(result.current.files).toHaveLength(3);
    expect(result.current.files.map((f) => f.id)).toEqual(["1", "2", "3"]);
    expect(result.current.error).toBeNull();
    expect(listFiles).toHaveBeenCalledTimes(1);
    // The injected args were passed through (parentId + tenantId flow)
    expect(listFiles).toHaveBeenCalledWith({ tenantId: TENANT, parentId: null });
  });

  it("transitions to success with an empty files array when the list is empty", async () => {
    const listFiles = vi.fn().mockResolvedValue({ ok: true as const, value: { items: [] as FileNode[] } });
    const { result } = renderHook(() =>
      useFileBrowser({ listFiles, parentId: null, tenantId: TENANT }),
    );

    act(() => {
      void result.current.refetch();
    });
    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });
    expect(result.current.files).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("transitions to error and preserves the FileSystemError when listFiles returns ok:false", async () => {
    const fsError = new FileSystemError({ code: "NetworkError", message: "boom", retryable: true });
    const listFiles = vi.fn().mockResolvedValue({ ok: false as const, error: fsError });
    const { result } = renderHook(() =>
      useFileBrowser({ listFiles, parentId: null, tenantId: TENANT }),
    );

    act(() => {
      void result.current.refetch();
    });
    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.files).toEqual([]);
    expect(result.current.error).toBe(fsError);
  });

  it("forwards the optional limit and prefix arguments to the injected listFiles callback", async () => {
    const listFiles = vi.fn().mockResolvedValue({ ok: true as const, value: { items: [] as FileNode[] } });
    const { result } = renderHook(() =>
      useFileBrowser({ listFiles, parentId: "p1", tenantId: TENANT, prefix: "photos/", limit: 25 }),
    );

    act(() => {
      void result.current.refetch();
    });
    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });
    expect(listFiles).toHaveBeenCalledWith({
      tenantId: TENANT,
      parentId: "p1",
      prefix: "photos/",
      limit: 25,
    });
  });
});
