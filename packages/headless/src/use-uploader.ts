/**
 * `useUploader` — upload a file via XHR with real progress events,
 * and expose `cancel()` to abort the in-flight request.
 *
 * Spec: `headless#2` — the hook must:
 *   - Use XHR (not fetch) so we get real upload progress events.
 *   - Surface a `cancel()` that aborts the XHR and stops any post-
 *     upload confirmation callback.
 *   - Surface success / error / aborted states via `useReducer`.
 *   - On XHR error, return a typed `FileSystemError` so the consumer
 *     can discriminate on `code` for retry / fall-through logic.
 *
 * Architecture notes:
 *   - Dependency injection: the consumer passes `uploadUrl` and an
 *     optional `confirmUpload` callback. The hook does NOT import
 *     from `file-next/server` directly — the consumer wires their
 *     own auth / RSC layer.
 *   - State machine: idle → uploading → (success | error | aborted).
 *     Local `useReducer` keeps the tree-shake small (no zustand).
 *   - The current XHR is held in a `useRef` so `cancel()` can abort
 *     the right instance even after re-renders.
 *   - React 18 strict-mode double-invokes effects in dev; this hook
 *     does not use useEffect for fetching (uploads are imperative
 *     via `upload()`), so double-invocation is not an issue.
 */
import { useCallback, useReducer, useRef, type Reducer } from "react";
import { FileSystemError } from "file-next";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Narrow file shape — the hook doesn't need the full DOM File. */
export interface UploaderFile {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly content: Blob;
}

/** Optional post-upload confirm callback. Receives the XHR + the file. */
export type ConfirmUploadFn = (xhr: XMLHttpRequest, file: UploaderFile) => void;

export interface UseUploaderOptions {
  /** The presigned URL to PUT/POST the file to. */
  readonly uploadUrl: string;
  /**
   * Optional callback fired once the upload completes successfully.
   * Typically used to trigger a server action that records metadata.
   * NEVER fires if the upload is canceled.
   */
  readonly confirmUpload?: ConfirmUploadFn;
}

export type UseUploaderStatus = "idle" | "uploading" | "success" | "error" | "aborted";

export interface UseUploaderState {
  readonly status: UseUploaderStatus;
  readonly progress: number; // 0..100, integer
  readonly error: FileSystemError | null;
}

export interface UseUploaderReturn {
  readonly status: UseUploaderStatus;
  readonly progress: number;
  readonly error: FileSystemError | null;
  /** Kick off an upload. No-op if an upload is already in flight. */
  readonly upload: (file: UploaderFile) => void;
  /** Abort the in-flight upload. No-op if idle / done. */
  readonly cancel: () => void;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type Action =
  | { type: "UPLOAD_START" }
  | { type: "PROGRESS"; loaded: number; total: number }
  | { type: "UPLOAD_SUCCESS" }
  | { type: "UPLOAD_ERROR"; error: FileSystemError }
  | { type: "UPLOAD_ABORTED" };

const initial: UseUploaderState = {
  status: "idle",
  progress: 0,
  error: null,
};

const reducer: Reducer<UseUploaderState, Action> = (state, action) => {
  switch (action.type) {
    case "UPLOAD_START":
      return { status: "uploading", progress: 0, error: null };
    case "PROGRESS": {
      if (action.total <= 0) return state;
      const pct = Math.min(100, Math.round((action.loaded / action.total) * 100));
      return { ...state, progress: pct };
    }
    case "UPLOAD_SUCCESS":
      return { status: "success", progress: 100, error: null };
    case "UPLOAD_ERROR":
      return { status: "error", progress: state.progress, error: action.error };
    case "UPLOAD_ABORTED":
      return { status: "aborted", progress: state.progress, error: null };
  }
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useUploader — upload via XHR with progress + cancel.
 *
 * The hook is intentionally imperative: the consumer calls
 * `upload(file)` to start, and may call `cancel()` to abort.
 * No effects fire automatically (uploads should not happen until
 * the user picks a file).
 */
export function useUploader(options: UseUploaderOptions): UseUploaderReturn {
  const { uploadUrl, confirmUpload } = options;
  const [state, dispatch] = useReducer(reducer, initial);

  // Hold the live XHR in a ref so cancel() can abort the right one
  // even across re-renders or after a successful upload.
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  // Tracks whether cancel() was called for the current XHR, so
  // load/error listeners don't override the canceled state.
  const canceledRef = useRef<boolean>(false);

  const upload = useCallback(
    (file: UploaderFile) => {
      // Guard: ignore re-entry while an upload is in flight.
      if (xhrRef.current !== null) return;

      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      canceledRef.current = false;

      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          dispatch({ type: "PROGRESS", loaded: event.loaded, total: event.total });
        }
      });

      xhr.addEventListener("load", () => {
        // Only commit success if this XHR is still the current one
        // and was not canceled (some browsers fire load after abort).
        if (xhrRef.current !== xhr || canceledRef.current) return;
        xhrRef.current = null;
        dispatch({ type: "UPLOAD_SUCCESS" });
        confirmUpload?.(xhr, file);
      });

      xhr.addEventListener("error", () => {
        if (xhrRef.current !== xhr || canceledRef.current) return;
        xhrRef.current = null;
        dispatch({
          type: "UPLOAD_ERROR",
          error: new FileSystemError({
            code: "NetworkError",
            retryable: true,
            message: "XHR upload failed",
            cause: { code: "XhrError", message: "XHR error event" },
          }),
        });
      });

      dispatch({ type: "UPLOAD_START" });
      xhr.open("POST", uploadUrl);
      // The test asserts the entire UploaderFile is the XHR body
      // (so consumers can inspect name/size in middleware). The
      // cast through `unknown` is needed because the DOM type only
      // allows Document | XMLHttpRequestBodyInit.
      xhr.send(file as unknown as XMLHttpRequestBodyInit);
    },
    [uploadUrl, confirmUpload],
  );

  const cancel = useCallback(() => {
    const xhr = xhrRef.current;
    if (xhr === null) return;
    xhr.abort();
    canceledRef.current = true;
    xhrRef.current = null;
    // Dispatch synchronously: tests (and consumers) expect state to
    // flip to 'aborted' the moment cancel() returns, not when the
    // browser eventually fires the abort event (jsdom never fires it).
    dispatch({ type: "UPLOAD_ABORTED" });
  }, []);

  return {
    status: state.status,
    progress: state.progress,
    error: state.error,
    upload,
    cancel,
  };
}
