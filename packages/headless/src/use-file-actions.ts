/**
 * `useFileActions` — optimistic delete / move / copy with rollback.
 *
 * Spec: `headless#3` — the hook must:
 *   - Apply an optimistic UI update immediately on call.
 *   - Restore the pre-mutation snapshot on action failure.
 *   - Surface the error via the `error` field so the consumer can
 *     decide whether to retry, log, or toast.
 *   - Track `isPending` so the consumer can disable buttons during
 *     the round-trip.
 *
 * Architecture notes:
 *   - Dependency injection: the consumer passes `actions` (the 3
 *     server-action callbacks) and `files` / `setFiles` (their state
 *     pair). The hook does NOT import from `file-next/server` and
 *     does NOT take ownership of the file list — the consumer
 *     remains the source of truth for the array.
 *   - State machine: idle → pending → (success | error). The
 *     `files` / `setFiles` pair lives OUTSIDE the reducer (it's the
 *     consumer's state). The reducer only tracks isPending + error.
 *   - The "snapshot" is just the original `files` reference. On
 *     failure we call `setFiles(snapshot)` to restore — because the
 *     snapshot is the same array reference, React skips re-render if
 *     the consumer memoizes on identity. On success we call
 *     `setFiles(next)` with the optimistic update.
 */
import { useCallback, useReducer, type Reducer } from "react";
import type { FileNode, FileSystemError, Result } from "file-next";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DeleteFileInput {
  readonly id: string;
}
export interface DeleteFileOutput {
  readonly id: string;
}

export interface MoveFileInput {
  readonly id: string;
  readonly newParentId: string;
}
export interface MoveFileOutput {
  readonly id: string;
}

export interface CopyFileInput {
  readonly id: string;
  readonly newParentId: string;
}
export interface CopyFileOutput {
  readonly node: FileNode;
}

export type DeleteFileFn = (input: DeleteFileInput) => Promise<Result<DeleteFileOutput, FileSystemError>>;
export type MoveFileFn = (input: MoveFileInput) => Promise<Result<MoveFileOutput, FileSystemError>>;
export type CopyFileFn = (input: CopyFileInput) => Promise<Result<CopyFileOutput, FileSystemError>>;

export interface UseFileActionsOptions {
  /** The current file list (consumer-owned). */
  readonly files: ReadonlyArray<FileNode>;
  /** The state setter for the file list (consumer-owned). */
  readonly setFiles: (next: ReadonlyArray<FileNode>) => void;
  /** The three server-action callbacks (typically wrappers around RSC actions). */
  readonly actions: {
    readonly deleteFile: DeleteFileFn;
    readonly moveFile: MoveFileFn;
    readonly copyFile: CopyFileFn;
  };
}

export type UseFileActionsStatus = "idle" | "pending";

export interface UseFileActionsState {
  readonly status: UseFileActionsStatus;
  readonly error: FileSystemError | null;
}

export interface UseFileActionsReturn {
  readonly status: UseFileActionsStatus;
  readonly isPending: boolean;
  readonly error: FileSystemError | null;
  readonly deleteFile: (id: string) => Promise<void>;
  readonly moveFile: (id: string, newParentId: string) => Promise<void>;
  readonly copyFile: (id: string, newParentId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type Action =
  | { type: "START" }
  | { type: "SUCCESS" }
  | { type: "ERROR"; error: FileSystemError };

const initial: UseFileActionsState = {
  status: "idle",
  error: null,
};

const reducer: Reducer<UseFileActionsState, Action> = (state, action) => {
  switch (action.type) {
    case "START":
      return { status: "pending", error: null };
    case "SUCCESS":
      return { status: "idle", error: null };
    case "ERROR":
      return { status: "idle", error: action.error };
  }
};

// ---------------------------------------------------------------------------
// Pure helpers (exported for testability)
// ---------------------------------------------------------------------------

/** Optimistic removal: drop the node with this id. */
export function applyDelete(
  files: ReadonlyArray<FileNode>,
  id: string,
): ReadonlyArray<FileNode> {
  return files.filter((f) => f.id !== id);
}

/** Optimistic move: change the parentId of the node with this id. */
export function applyMove(
  files: ReadonlyArray<FileNode>,
  id: string,
  newParentId: string,
): ReadonlyArray<FileNode> {
  return files.map((f) => (f.id === id ? { ...f, parentId: newParentId } : f));
}

/** Optimistic copy: append the new sibling node. */
export function applyCopy(
  files: ReadonlyArray<FileNode>,
  node: FileNode,
): ReadonlyArray<FileNode> {
  return [...files, node];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useFileActions — optimistic mutations with rollback.
 *
 * Each mutator:
 *   1. Snapshots the current `files` reference.
 *   2. Dispatches `START` (isPending = true).
 *   3. Calls `setFiles(optimistic)` immediately.
 *   4. Awaits the action.
 *   5. On `ok: true`, dispatches `SUCCESS` (no further setFiles — the
 *      server's response is the new truth; the optimistic value
 *      either matches or the consumer reconciles via refresh).
 *   6. On `ok: false`, calls `setFiles(snapshot)` to roll back, then
 *      dispatches `ERROR`.
 */
export function useFileActions(options: UseFileActionsOptions): UseFileActionsReturn {
  const { files, setFiles, actions } = options;
  const [state, dispatch] = useReducer(reducer, initial);

  // Generic runner: snapshot + optimistic apply + rollback on err.
  const run = useCallback(
    async <TInput, TOutput>(args: {
      input: TInput;
      optimistic: () => ReadonlyArray<FileNode>;
      act: (input: TInput) => Promise<Result<TOutput, FileSystemError>>;
      /** Extract any additional file-list mutation from a successful result. */
      onSuccess?: (output: TOutput) => ReadonlyArray<FileNode>;
    }): Promise<void> => {
      const snapshot = files;
      const optimisticNext = args.optimistic();
      dispatch({ type: "START" });
      // Skip setFiles when the optimistic update returns the same
      // reference (e.g., copyFile — we don't know the new id until
      // the server responds). Calling setFiles with identity-equal
      // data is a no-op for React but still fires the spy.
      if (optimisticNext !== snapshot) {
        setFiles(optimisticNext);
      }
      const result = await args.act(args.input);
      if (result.ok) {
        if (args.onSuccess) {
          setFiles(args.onSuccess(result.value));
        }
        dispatch({ type: "SUCCESS" });
      } else {
        setFiles(snapshot);
        dispatch({ type: "ERROR", error: result.error });
      }
    },
    [files, setFiles],
  );

  const deleteFile = useCallback(
    (id: string) =>
      run({
        input: { id },
        optimistic: () => applyDelete(files, id),
        act: actions.deleteFile,
      }),
    [run, actions.deleteFile, files],
  );

  const moveFile = useCallback(
    (id: string, newParentId: string) =>
      run({
        input: { id, newParentId },
        optimistic: () => applyMove(files, id, newParentId),
        act: actions.moveFile,
      }),
    [run, actions.moveFile, files],
  );

  const copyFile = useCallback(
    (id: string, newParentId: string) =>
      run({
        input: { id, newParentId },
        optimistic: () => files, // copy doesn't remove anything
        act: actions.copyFile,
        onSuccess: (output) => applyCopy(files, output.node),
      }),
    [run, actions.copyFile, files],
  );

  return {
    status: state.status,
    isPending: state.status === "pending",
    error: state.error,
    deleteFile,
    moveFile,
    copyFile,
  };
}
