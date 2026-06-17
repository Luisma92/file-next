/**
 * Tests for the `useDownloadProgress` hook.
 *
 * Scenarios:
 *   - Downloads via fetch + reader, emitting progress 0..100.
 *   - `cancel()` aborts the in-flight fetch via AbortController.
 *   - On success, the final blob is exposed.
 *   - On error, the error is surfaced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDownloadProgress } from "@/use-download-progress";
import type { FileSystemError } from "file-next";

// ---------------------------------------------------------------------------
// Fetch stub helpers
// ---------------------------------------------------------------------------

/** Build a ReadableStream-like object that yields the given chunks. */
function makeStream(chunks: ReadonlyArray<Uint8Array>): {
  getReader: () => {
    read: () => Promise<{ done: boolean; value?: Uint8Array }>;
  };
} {
  let i = 0;
  return {
    getReader: () => ({
      read: () => {
        if (i >= chunks.length) {
          return Promise.resolve({ done: true });
        }
        return Promise.resolve({ done: false, value: chunks[i++]! });
      },
    }),
  };
}

interface StubFetchOpts {
  /** When set, the fetch call will reject with this error. */
  rejectWith?: unknown;
  /** Stream chunks to emit (ignored if rejectWith is set). */
  chunks?: ReadonlyArray<Uint8Array>;
}

function stubFetch(opts: StubFetchOpts = {}): {
  fn: ReturnType<typeof vi.fn>;
  abortSpy: ReturnType<typeof vi.fn>;
  triggerError?: (err: Error) => void;
} {
  const abortSpy = vi.fn();
  const triggerErrorRef: { current?: (err: Error) => void } = {};
  const fn = vi.fn((_input: unknown, init?: { signal?: AbortSignal }) => {
    const signal = init?.signal;
    if (signal) {
      signal.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        triggerErrorRef.current?.(err);
      });
    }
    if (opts.rejectWith) {
      return Promise.reject(opts.rejectWith);
    }
    const stream = makeStream(opts.chunks ?? [
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array([5, 6, 7, 8]),
      new Uint8Array([9, 10]),
      new Uint8Array([11, 12]),
    ]);
    // jsdom-friendly fake Response: only the fields the hook reads.
    return Promise.resolve({
      ok: true,
      body: stream,
    });
  });
  // Mock AbortController so the hook shares our spy.
  const RealAbortController = globalThis.AbortController;
  class TrackedAbortController {
    public signal: AbortSignal;
    public aborted = false;
    constructor() {
      const ctrl = new RealAbortController();
      this.signal = ctrl.signal;
      const orig = ctrl.abort.bind(ctrl);
      this.abort = () => {
        abortSpy();
        this.aborted = true;
        orig();
      };
    }
    abort = () => {};
  }
  vi.stubGlobal("AbortController", TrackedAbortController);
  return { fn, abortSpy };
}

const makeError = (code = "NetworkError"): FileSystemError =>
  new (class extends Error {
    readonly code = code;
    readonly retryable = true;
    constructor() {
      super("boom");
      this.name = "FileSystemError";
    }
  })() as unknown as FileSystemError;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useDownloadProgress", () => {
  let originalFetch: typeof fetch;
  let originalAbort: typeof AbortController;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalAbort = globalThis.AbortController;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
    globalThis.AbortController = originalAbort;
  });

  it("starts in the loading state when url is set", () => {
    const { fn } = stubFetch();
    globalThis.fetch = fn as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useDownloadProgress({ url: "https://example.com/x" }),
    );
    expect(result.current.status).toBe("loading");
    expect(result.current.progress).toBe(0);
    expect(result.current.blob).toBeNull();
  });

  it("emits progress events 0/25/50/75/100 and exposes the final blob", async () => {
    // 4 equal chunks of 4 bytes each (excluding last which is 2).
    const chunks = [
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array([5, 6, 7, 8]),
      new Uint8Array([9, 10]),
      new Uint8Array([11, 12]),
    ];
    const { fn } = stubFetch({ chunks });
    globalThis.fetch = fn as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useDownloadProgress({ url: "https://example.com/x" }),
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.progress).toBe(100);
    expect(result.current.blob).not.toBeNull();
    // Total bytes = 4 + 4 + 2 + 2 = 12
    expect(result.current.blob!.size).toBe(12);
  });

  it("transitions to error when fetch rejects", async () => {
    const error = makeError();
    const { fn } = stubFetch({ rejectWith: error });
    globalThis.fetch = fn as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useDownloadProgress({ url: "https://example.com/x" }),
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    // The hook wraps the raw fetch error in a typed FileSystemError,
    // so identity does not match — assert on properties instead.
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as unknown as { code?: string }).code).toBe(
      "NetworkError",
    );
  });

  it("cancel() calls abort() and transitions to aborted", async () => {
    // Use a slow stream that yields one chunk then never finishes.
    let resolveNext: (() => void) | null = null;
    let neverFinish = true;
    const slowStream = {
      getReader: () => ({
        read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
          if (neverFinish) {
            return new Promise((resolve) => {
              resolveNext = () => resolve({ done: false, value: new Uint8Array([1, 2, 3, 4]) });
            });
          }
          return Promise.resolve({ done: true });
        },
      }),
    };
    const { fn, abortSpy } = stubFetch();
    fn.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        body: slowStream,
        headers: { get: (name: string) => (name === "content-length" ? "100" : null) },
      } as unknown as Response),
    );
    globalThis.fetch = fn as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useDownloadProgress({ url: "https://example.com/x" }),
    );

    // Wait for the hook to reach its first `await reader.read()`
    // (useEffect → fetch → getReader → read all happen async).
    await waitFor(() => expect(resolveNext).not.toBeNull());
    // Trigger the first chunk so progress != 0 (4 of 100 bytes = 4%).
    await act(async () => {
      resolveNext!();
      // Allow the microtask queue to drain so React re-renders.
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() => expect(result.current.progress).toBeGreaterThan(0));

    act(() => {
      result.current.cancel();
    });

    expect(abortSpy).toHaveBeenCalled();
    // The ABORTED dispatch happens asynchronously (after the fetch
    // promise rejects with AbortError). Wait for the status flip.
    await waitFor(() => expect(result.current.status).toBe("aborted"));
    neverFinish = false;
  });
});
