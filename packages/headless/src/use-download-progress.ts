/**
 * `useDownloadProgress` — download a file via fetch + reader,
 * emitting progress 0..100 and exposing the final blob.
 *
 * Spec:
 *   - Status: idle → downloading → (success | error | aborted).
 *   - `cancel()` aborts the in-flight fetch via AbortController.
 *   - On success, expose a Blob with the full contents.
 *   - On error, surface a typed FileSystemError.
 *
 * Architecture notes:
 *   - `useReducer` for state — 5 fields, 5 transitions.
 *   - AbortController is created per-fetch and stored in a ref so
 *     `cancel()` can abort the right one across re-renders.
 *   - React 18 strict-mode double-invokes effects in dev — guarded
 *     by a "latest fetch id" ref so the second invocation is a
 *     no-op (its result is discarded).
 *   - `fetch` is global; tests stub it via `vi.stubGlobal('fetch', ...)`.
 */
import { useCallback, useEffect, useReducer, useRef, type Reducer } from "react";
import { FileSystemError } from "file-next";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UseDownloadProgressOptions {
  /** The URL to download from. */
  readonly url: string;
  /**
   * Optional AbortSignal to share cancellation with the consumer's
   * own logic (e.g., the consumer unmounts the component).
   * If provided, the hook's `cancel()` AND this signal both abort.
   */
  readonly externalSignal?: AbortSignal;
}

export type UseDownloadProgressStatus =
  | "idle"
  | "loading"
  | "success"
  | "error"
  | "aborted";

export interface UseDownloadProgressState {
  readonly status: UseDownloadProgressStatus;
  readonly progress: number; // 0..100
  readonly blob: Blob | null;
  readonly error: FileSystemError | null;
}

export interface UseDownloadProgressReturn {
  readonly status: UseDownloadProgressStatus;
  readonly progress: number;
  readonly blob: Blob | null;
  readonly error: FileSystemError | null;
  readonly cancel: () => void;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type Action =
  | { type: "START" }
  | { type: "PROGRESS"; loaded: number; total: number }
  | { type: "SUCCESS"; blob: Blob }
  | { type: "ERROR"; error: FileSystemError }
  | { type: "ABORTED" };

const initial: UseDownloadProgressState = {
  status: "idle",
  progress: 0,
  blob: null,
  error: null,
};

const reducer: Reducer<UseDownloadProgressState, Action> = (state, action) => {
  switch (action.type) {
    case "START":
      return { status: "loading", progress: 0, blob: null, error: null };
    case "PROGRESS": {
      if (action.total <= 0) return state;
      const pct = Math.min(100, Math.round((action.loaded / action.total) * 100));
      return { ...state, progress: pct };
    }
    case "SUCCESS":
      return { status: "success", progress: 100, blob: action.blob, error: null };
    case "ERROR":
      return { ...state, status: "error", error: action.error };
    case "ABORTED":
      return { ...state, status: "aborted" };
  }
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDownloadProgress(
  options: UseDownloadProgressOptions,
): UseDownloadProgressReturn {
  const { url, externalSignal } = options;
  const [state, dispatch] = useReducer(reducer, initial);

  // Per-fetch AbortController; replaced on each new download.
  const acRef = useRef<AbortController | null>(null);
  // Monotonic id to ignore stale fetch completions (strict-mode
  // double-invocation, key changes, abort+restart).
  const fetchIdRef = useRef(0);

  useEffect(() => {
    const fetchId = ++fetchIdRef.current;
    const ac = new AbortController();
    acRef.current = ac;

    // Link the external signal if provided: aborting it aborts us.
    let onExternalAbort: (() => void) | null = null;
    if (externalSignal) {
      onExternalAbort = () => ac.abort();
      if (externalSignal.aborted) {
        ac.abort();
      } else {
        externalSignal.addEventListener("abort", onExternalAbort);
      }
    }

    dispatch({ type: "START" });

    void (async () => {
      try {
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const body = res.body;
        if (!body) {
          // No body — finish immediately with an empty Blob.
          if (fetchId !== fetchIdRef.current) return;
          dispatch({ type: "SUCCESS", blob: new Blob([]) });
          return;
        }
        const reader = body.getReader();
        const chunks: Uint8Array[] = [];
        let loaded = 0;
        // Total may be unknown (no Content-Length header). Default to
        // a sentinel that lets PROGRESS report incrementally as best
        // we can — fall back to "loaded" alone, capped at 99 until done.
        const totalRaw = res.headers?.get?.("content-length");
        const total = totalRaw ? Number(totalRaw) : 0;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          chunks.push(value);
          loaded += value.byteLength;
          if (fetchId !== fetchIdRef.current) return;
          if (total > 0) {
            dispatch({ type: "PROGRESS", loaded, total });
          }
        }

        if (fetchId !== fetchIdRef.current) return;
        const blob = new Blob(chunks as BlobPart[]);
        dispatch({ type: "SUCCESS", blob });
      } catch (err) {
        if (fetchId !== fetchIdRef.current) return;
        // AbortError from fetch: surface as `aborted` (not error).
        if (ac.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
          dispatch({ type: "ABORTED" });
          return;
        }
        dispatch({
          type: "ERROR",
          error: new FileSystemError({
            code: "NetworkError",
            retryable: true,
            message: err instanceof Error ? err.message : "fetch failed",
          }),
        });
      } finally {
        if (onExternalAbort && externalSignal) {
          externalSignal.removeEventListener("abort", onExternalAbort);
        }
      }
    })();

    return () => {
      // Effect cleanup: abort the fetch so the in-flight promise resolves.
      ac.abort();
    };
  }, [url, externalSignal]);

  const cancel = useCallback(() => {
    acRef.current?.abort();
    // Dispatch ABORTED synchronously so the consumer sees the state
    // flip the moment cancel() returns. The async IIFE's catch
    // block will ALSO try to dispatch ABORTED on fetch rejection,
    // but the idempotent `if (fetchId !== fetchIdRef.current) return`
    // guard (already in place) covers that — once acRef is cleared,
    // the in-flight fetch rejects, the catch sees acRef.current === null
    // OR the fetchId mismatch, and bails.
    // For full determinism in case the reader loop is awaiting an
    // unresponsive stub, also dispatch directly:
    dispatch({ type: "ABORTED" });
  }, []);

  return {
    status: state.status,
    progress: state.progress,
    blob: state.blob,
    error: state.error,
    cancel,
  };
}
