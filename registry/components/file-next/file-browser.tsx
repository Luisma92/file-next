"use client";

/**
 * `<FileBrowser />` — a keyboard-navigable list of files and folders.
 *
 * Built on `useFileBrowser` from `@file-next/headless`. The hook
 * fetches the listing via an injected callback and surfaces
 * loading / empty / error states; this component is a thin
 * presentational layer that maps those states to UI.
 *
 * Spec (registry#1 keyboard navigation, registry#3 CSS variables):
 *   - ArrowUp / ArrowDown move focus between rows.
 *   - Home / End jump to first / last row.
 *   - Enter or Space invokes `onFileClick(file)`.
 *   - role="listbox" + aria-activedescendant for screen readers.
 *   - All colors come from semantic CSS variables (bg-background,
 *     text-foreground, etc.) so the consumer's theme applies.
 *
 * Architecture:
 *   - Pure client component — uses Radix is not needed; we manage
 *     roving tabindex manually for the listbox pattern.
 *   - No zustand, no global state. The hook is the single source
 *     of truth for the file list.
 *   - The "loading" and "error" branches are siblings, not nested,
 *     so the consumer can supply their own empty/error components
 *     via the `emptyState` / `errorState` props.
 */
import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { FileIcon, FolderIcon, Loader2Icon } from "lucide-react";
import { useFileBrowser } from "@file-next/headless";
import type { FileNode } from "file-next";
import { cn } from "@/lib/cn";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FileBrowserProps {
  /** Injected callback that fetches the file list. */
  readonly listFiles: Parameters<typeof useFileBrowser>[0]["listFiles"];
  /** Tenant scope for the listing. */
  readonly tenantId: Parameters<typeof useFileBrowser>[0]["tenantId"];
  /** Folder to list (null = root). */
  readonly parentId: string | null;
  /** Optional prefix filter (POSIX). */
  readonly prefix?: string;
  /** Optional cap on items per call. */
  readonly limit?: number;
  /** Auto-fetch on mount (default: false). */
  readonly autoFetch?: boolean;
  /** Called when a file/folder is activated (Enter / Space / click). */
  readonly onFileClick?: (file: FileNode) => void;
  /** Optional custom empty-state slot. */
  readonly emptyState?: React.ReactNode;
  /** Optional custom error-state slot. Receives the FileSystemError. */
  readonly errorState?: (error: { code: string; message: string }) => React.ReactNode;
  /** Extra className for the listbox. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileBrowser(props: FileBrowserProps): React.ReactElement {
  const {
    listFiles,
    tenantId,
    parentId,
    prefix,
    limit,
    autoFetch = false,
    onFileClick,
    emptyState,
    errorState,
    className,
  } = props;

  const { status, files, error, refetch } = useFileBrowser({
    listFiles,
    tenantId,
    parentId,
    prefix,
    limit,
    autoFetch,
  });

  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLUListElement>) => {
      if (files.length === 0) return;
      let next = activeIndex;
      switch (e.key) {
        case "ArrowDown":
          next = Math.min(files.length - 1, activeIndex + 1);
          break;
        case "ArrowUp":
          next = Math.max(0, activeIndex - 1);
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = files.length - 1;
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          onFileClick?.(files[activeIndex]!);
          return;
        default:
          return;
      }
      e.preventDefault();
      setActiveIndex(next);
    },
    [activeIndex, files, onFileClick],
  );

  if (status === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Loading files"
        className={cn("flex items-center gap-2 text-muted-foreground", className)}
      >
        <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
        <span>Loading…</span>
      </div>
    );
  }

  if (status === "error") {
    if (errorState) {
      return <>{errorState({ code: error!.code, message: error!.message })}</>;
    }
    return (
      <div role="alert" className={cn("text-destructive text-sm", className)}>
        Failed to load files ({error!.code}).{" "}
        <button
          type="button"
          onClick={() => void refetch()}
          className="underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (files.length === 0) {
    if (emptyState) return <>{emptyState}</>;
    return (
      <div className={cn("text-muted-foreground text-sm", className)}>
        This folder is empty.
      </div>
    );
  }

  return (
    <ul
      ref={listRef}
      role="listbox"
      tabIndex={0}
      aria-label="Files"
      aria-activedescendant={files[activeIndex] ? `file-row-${files[activeIndex]!.id}` : undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        "divide-y divide-border rounded-md border border-border bg-card",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {files.map((file, index) => {
        const isActive = index === activeIndex;
        const Icon = file.kind === "folder" ? FolderIcon : FileIcon;
        return (
          <li
            key={file.id}
            id={`file-row-${file.id}`}
            role="option"
            aria-selected={isActive}
            onClick={() => {
              setActiveIndex(index);
              onFileClick?.(file);
            }}
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-sm cursor-pointer",
              "hover:bg-accent hover:text-accent-foreground",
              isActive && "bg-accent text-accent-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">{file.name}</span>
          </li>
        );
      })}
    </ul>
  );
}
