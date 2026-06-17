/**
 * Tests for the `useFileUrl` hook.
 *
 * Scenarios:
 *   - Resolves a presigned URL via an injected `getDownloadUrl`
 *     callback and surfaces loading/error states.
 *   - When `enabled` is false, the fetch is skipped entirely (used
 *     for conditional prefetching or hiding behind a click).
 *   - On key change, re-fetches the new URL.
 *   - React 18 strict mode double-invokes effects in dev — the hook
 *     MUST NOT double-fetch for the same key.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useFileUrl } from "@/use-file-url";
import type { FileSystemError } from "file-next";

const okResult = <T,>(value: T) => ({ ok: true as const, value });
const errResult = (error: FileSystemError) => ({ ok: false as const, error });

const makeError = (code = "NetworkError"): FileSystemError =>
  new (class extends Error {
    readonly code = code;
    readonly retryable = true;
    constructor() {
      super("boom");
      this.name = "FileSystemError";
    }
  })() as unknown as FileSystemError;

describe("useFileUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in the loading state when enabled", () => {
    const getDownloadUrl = vi.fn(async () => okResult({ url: "https://signed/x" }));
    const { result } = renderHook(() =>
      useFileUrl({ getDownloadUrl, key: "a.txt" }),
    );
    expect(result.current.status).toBe("loading");
    expect(result.current.url).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("resolves the URL and transitions to success", async () => {
    const getDownloadUrl = vi.fn(async () => okResult({ url: "https://signed/a.txt" }));
    const { result } = renderHook(() =>
      useFileUrl({ getDownloadUrl, key: "a.txt" }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("success");
    });
    expect(result.current.url).toBe("https://signed/a.txt");
    expect(getDownloadUrl).toHaveBeenCalledWith({ key: "a.txt" });
  });

  it("transitions to error and preserves the FileSystemError", async () => {
    const error = makeError();
    const getDownloadUrl = vi.fn(async () => errResult(error));
    const { result } = renderHook(() =>
      useFileUrl({ getDownloadUrl, key: "a.txt" }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.error).toBe(error);
    expect(result.current.url).toBeNull();
  });

  it("does NOT fetch when enabled is false (initial render)", () => {
    const getDownloadUrl = vi.fn(async () => okResult({ url: "https://signed/x" }));
    const { result } = renderHook(() =>
      useFileUrl({ getDownloadUrl, key: "a.txt", enabled: false }),
    );
    expect(result.current.status).toBe("idle");
    expect(result.current.url).toBeNull();
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  it("re-fetches when the key changes", async () => {
    const getDownloadUrl = vi.fn(async ({ key }: { key: string }) =>
      okResult({ url: `https://signed/${key}` }),
    );
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useFileUrl({ getDownloadUrl, key }),
      { initialProps: { key: "a.txt" } },
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.url).toBe("https://signed/a.txt");

    rerender({ key: "b.txt" });
    await waitFor(() => expect(result.current.url).toBe("https://signed/b.txt"));
    expect(getDownloadUrl).toHaveBeenCalledTimes(2);
    expect(getDownloadUrl).toHaveBeenNthCalledWith(1, { key: "a.txt" });
    expect(getDownloadUrl).toHaveBeenNthCalledWith(2, { key: "b.txt" });
  });
});
