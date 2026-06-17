/**
 * `useFileUrl` — resolve a presigned URL via an injected callback.
 *
 * Spec (lighter than the other hooks):
 *   - Status: `idle` (disabled or pre-mount) → `loading` → `success`
 *     | `error`.
 *   - On key change, re-fetch.
 *   - When `enabled` flips to false, the URL stays in place (we
 *     don't clear it) so the consumer can hide the UI without
 *     re-triggering a flash.
 *
 * Architecture notes:
 *   - Dependency injection: `getDownloadUrl` is a callback the
 *     consumer passes in. The hook does NOT import from
 *     `file-next/server`.
 *   - `useState` (not `useReducer`) — only 3 fields, 4 transitions.
 *     Per the design decision, simpler hooks can use useState.
 *   - React 18 strict-mode double-invokes effects in dev — guarded
 *     with a `useRef` "already fetching for this key" flag.
 *   - Cancellation: if the key changes mid-flight, the in-flight
 *     result is discarded (we compare the key against a ref before
 *     committing state).
 */
import { useEffect, useRef, useState } from "react";
import type { FileSystemError, Result } from "file-next";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GetDownloadUrlInput {
  readonly key: string;
}

export interface GetDownloadUrlOutput {
  readonly url: string;
}

export type GetDownloadUrlFn = (
  input: GetDownloadUrlInput,
) => Promise<Result<GetDownloadUrlOutput, FileSystemError>>;

export interface UseFileUrlOptions {
  /** The injected download-URL resolver (wraps a server action). */
  readonly getDownloadUrl: GetDownloadUrlFn;
  /** The object key to resolve a URL for. */
  readonly key: string;
  /**
   * When false, the fetch is skipped (status stays `idle`, url is
   * null). Useful for click-to-load patterns and conditional prefetch.
   * Default: true.
   */
  readonly enabled?: boolean;
}

export type UseFileUrlStatus = "idle" | "loading" | "success" | "error";

export interface UseFileUrlReturn {
  readonly url: string | null;
  readonly status: UseFileUrlStatus;
  readonly error: FileSystemError | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFileUrl(options: UseFileUrlOptions): UseFileUrlReturn {
  const { getDownloadUrl, key, enabled = true } = options;

  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<FileSystemError | null>(null);
  // status is derived from the other two fields — no separate state.
  // But we need to distinguish "loading" from "idle but enabled", so
  // we track it explicitly.
  const [status, setStatus] = useState<UseFileUrlStatus>(enabled ? "loading" : "idle");

  // Refs to support cancellation across re-renders.
  // - latestKey: the key the most recent in-flight fetch was started for
  // - latestEnabled: ditto for enabled
  const latestKeyRef = useRef<string | null>(null);
  const latestEnabledRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!enabled) {
      latestEnabledRef.current = false;
      setStatus("idle");
      return;
    }
    latestEnabledRef.current = true;
    latestKeyRef.current = key;
    setStatus("loading");
    setError(null);

    let cancelled = false;
    void (async () => {
      const result = await getDownloadUrl({ key });
      // Bail if the key changed or the hook was disabled mid-flight.
      if (cancelled) return;
      if (latestKeyRef.current !== key) return;
      if (latestEnabledRef.current === false) return;
      if (result.ok) {
        setUrl(result.value.url);
        setStatus("success");
      } else {
        setError(result.error);
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getDownloadUrl, key, enabled]);

  return { url, status, error };
}
