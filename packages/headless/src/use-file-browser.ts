/**
 * `useFileBrowser` — fetch a file listing via an injected callback
 * and surface loading / empty / error states via a `useReducer`-
 * driven state machine.
 *
 * Spec: `headless#1` — the hook must surface loading/empty/error.
 *
 * Architecture notes:
 *   - Dependency injection: the consumer passes `listFiles` as a
 *     prop. The hook does NOT import from `file-next/server`
 *     directly — the headless package is client-only, and the
 *     consumer wires their own auth / RSC layer around the callback.
 *   - State machine: idle → loading → (success | error). Errors are
 *     preserved as-is (typed `FileSystemError`) so the consumer can
 *     discriminate on `code` for retry / fall-through logic.
 *   - No zustand, no global state lib. Local `useReducer` keeps the
 *     tree-shake small and the consumer's state lib unopinionated.
 */
import { useCallback, useEffect, useReducer, type Reducer } from "react";
import type { FileNode, FileSystemError, Result, TenantId } from "file-next";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Narrow shape of what the hook needs from the server action. */
export type ListFilesInput = {
  readonly tenantId: TenantId;
  readonly parentId: string | null;
  readonly prefix?: string;
  readonly limit?: number;
};

export type ListFilesOutput = {
  readonly items: ReadonlyArray<FileNode>;
};

/** The injected dependency. Returns the same Result shape the server uses. */
export type ListFilesFn = (input: ListFilesInput) => Promise<Result<ListFilesOutput, FileSystemError>>;

export interface UseFileBrowserOptions {
  /** The list callback (injected; typically wraps a server action). */
  readonly listFiles: ListFilesFn;
  /** Tenant scope — forwarded to every listFiles call. */
  readonly tenantId: TenantId;
  /** Folder to list (null = root). */
  readonly parentId: string | null;
  /** Optional S3 prefix filter. */
  readonly prefix?: string;
  /** Optional cap on items per call. */
  readonly limit?: number;
  /**
   * Auto-fetch on mount (default: false). The spec describes the
   * state machine as `idle → user calls refetch() → loading → ...`,
   * so the hook is imperative by default. Set `true` to fetch as
   * soon as the component mounts (typical for full-page file
   * browsers that want to show data immediately).
   */
  readonly autoFetch?: boolean;
}

export type UseFileBrowserStatus = "idle" | "loading" | "success" | "error";

export interface UseFileBrowserState {
  readonly status: UseFileBrowserStatus;
  readonly files: ReadonlyArray<FileNode>;
  readonly error: FileSystemError | null;
}

export interface UseFileBrowserReturn {
  readonly status: UseFileBrowserStatus;
  readonly files: ReadonlyArray<FileNode>;
  readonly error: FileSystemError | null;
  /** Re-run the listFiles call. Safe to call any time; cancels nothing. */
  readonly refetch: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type Action =
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; files: ReadonlyArray<FileNode> }
  | { type: "FETCH_ERROR"; error: FileSystemError };

const initial: UseFileBrowserState = {
  status: "idle",
  files: [],
  error: null,
};

const reducer: Reducer<UseFileBrowserState, Action> = (state, action) => {
  switch (action.type) {
    case "FETCH_START":
      return { status: "loading", files: [], error: null };
    case "FETCH_SUCCESS":
      return { status: "success", files: action.files, error: null };
    case "FETCH_ERROR":
      return { status: "error", files: [], error: action.error };
  }
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useFileBrowser — list files for a folder via an injected callback.
 *
 * The hook fires the list on mount (unless `autoFetch: false`) and
 * exposes a stable `refetch` to re-run. The state is local: every
 * consumer instance has its own state machine.
 */
export function useFileBrowser(options: UseFileBrowserOptions): UseFileBrowserReturn {
  const { listFiles, tenantId, parentId, prefix, limit, autoFetch = false } = options;
  const [state, dispatch] = useReducer(reducer, initial);

  const run = useCallback(async (): Promise<void> => {
    dispatch({ type: "FETCH_START" });
    const result = await listFiles({ tenantId, parentId, prefix, limit });
    if (result.ok) {
      dispatch({ type: "FETCH_SUCCESS", files: result.value.items });
    } else {
      dispatch({ type: "FETCH_ERROR", error: result.error });
    }
  }, [listFiles, tenantId, parentId, prefix, limit]);

  useEffect(() => {
    if (autoFetch) {
      void run();
    }
  }, [autoFetch, run]);

  return {
    status: state.status,
    files: state.files,
    error: state.error,
    refetch: run,
  };
}
