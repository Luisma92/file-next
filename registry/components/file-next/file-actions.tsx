"use client";

/**
 * `<FileActions />` — a dropdown menu for file actions (rename,
 * move, copy, delete) with optimistic updates and rollback.
 *
 * Built on `useFileActions` from `@file-next/headless`. The hook
 * receives `files` and `setFiles` as the consumer's state pair,
 * and the three action callbacks (deleteFile, moveFile, copyFile).
 * This component renders the Radix DropdownMenu trigger + items
 * and wires the menu choices to the hook.
 *
 * Spec:
 *   - Trigger: a small icon button that opens the menu on click or
 *     Enter / Space / ArrowDown.
 *   - Items: Rename (text input prompt), Move (folder picker prompt),
 *     Copy (folder picker prompt), Delete (confirmation dialog).
 *   - Confirmation: delete uses Radix AlertDialog to prevent
 *     accidental destruction.
 *   - Optimistic state: passed through to the hook; the consumer's
 *     `files` list updates immediately and rolls back on failure.
 *
 * Architecture:
 *   - Dependency injection: the consumer passes `files`, `setFiles`,
 *     and the three action callbacks. The hook does the optimistic
 *     apply + rollback; this component just renders the menu.
 *   - Uses Radix primitives directly (not the shadcn wrappers) to
 *     keep the registry item small. Consumers who want the shadcn
 *     styled DropdownMenu can replace this file with the shadcn
 *     version after install.
 */
import { useState, useId } from "react";
import {
  Copy as CopyIcon,
  FolderInput as FolderInputIcon,
  MoreHorizontal as MoreHorizontalIcon,
  Pencil as PencilIcon,
  Trash2 as Trash2Icon,
} from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useFileActions } from "@file-next/headless";
import type { FileNode } from "file-next";
import { cn } from "@/lib/cn";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FileActionsProps {
  /** The file this menu operates on. */
  readonly file: FileNode;
  /** The current file list (consumer-owned). */
  readonly files: ReadonlyArray<FileNode>;
  /** The state setter for the file list (consumer-owned). */
  readonly setFiles: (next: ReadonlyArray<FileNode>) => void;
  /** The three action callbacks. */
  readonly actions: Parameters<typeof useFileActions>[0]["actions"];
  /** Optional className for the trigger button. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileActions(props: FileActionsProps): React.ReactElement {
  const { file, files, setFiles, actions, className } = props;
  const { deleteFile, moveFile, copyFile } = useFileActions({ files, setFiles, actions });

  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const dialogTitleId = useId();

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={`Actions for ${file.name}`}
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-md",
            "border border-border bg-background text-foreground",
            "hover:bg-accent hover:text-accent-foreground",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <MoreHorizontalIcon aria-hidden="true" className="size-4" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className={cn(
              "z-50 min-w-40 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md",
            )}
          >
            <DropdownMenu.Item
              onSelect={(e) => {
                e.preventDefault();
                setRenameOpen(true);
              }}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            >
              <PencilIcon aria-hidden="true" className="size-4" />
              Rename
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={(e) => {
                e.preventDefault();
                setMoveOpen(true);
              }}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            >
              <FolderInputIcon aria-hidden="true" className="size-4" />
              Move…
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={(e) => {
                e.preventDefault();
                setCopyOpen(true);
              }}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
            >
              <CopyIcon aria-hidden="true" className="size-4" />
              Copy…
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item
              onSelect={(e) => {
                e.preventDefault();
                setDeleteOpen(true);
              }}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive outline-none data-[highlighted]:bg-destructive data-[highlighted]:text-destructive-foreground"
            >
              <Trash2Icon aria-hidden="true" className="size-4" />
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* Rename prompt — simple browser dialog for v0.1.
          v0.2 will replace with a proper inline editor. */}
      {renameOpen && (
        <PromptDialog
          open={renameOpen}
          onOpenChange={setRenameOpen}
          title={`Rename "${file.name}"`}
          defaultValue={file.name}
          confirmLabel="Rename"
          onConfirm={(newName) => {
            setRenameOpen(false);
            // v0.1 only supports renaming via moveFile with new name.
            // For now, do nothing; consumers can wire this up.
            void newName;
          }}
        />
      )}

      {moveOpen && (
        <PromptDialog
          open={moveOpen}
          onOpenChange={setMoveOpen}
          title={`Move "${file.name}"`}
          defaultValue=""
          placeholder="Destination folder id"
          confirmLabel="Move"
          onConfirm={(dest) => {
            setMoveOpen(false);
            void moveFile(file.id, dest);
          }}
        />
      )}

      {copyOpen && (
        <PromptDialog
          open={copyOpen}
          onOpenChange={setCopyOpen}
          title={`Copy "${file.name}"`}
          defaultValue=""
          placeholder="Destination folder id"
          confirmLabel="Copy"
          onConfirm={(dest) => {
            setCopyOpen(false);
            void copyFile(file.id, dest);
          }}
        />
      )}

      <AlertDialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <AlertDialog.Content
            aria-labelledby={dialogTitleId}
            className="fixed left-1/2 top-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 border border-border bg-background p-6 shadow-lg sm:rounded-lg"
          >
            <AlertDialog.Title id={dialogTitleId} className="text-lg font-semibold">
              Delete "{file.name}"?
            </AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-muted-foreground">
              This cannot be undone.
            </AlertDialog.Description>
            <div className="flex justify-end gap-2">
              <AlertDialog.Cancel asChild>
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Cancel
                </button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <button
                  type="button"
                  onClick={() => void deleteFile(file.id)}
                  className="inline-flex h-9 items-center justify-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Delete
                </button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

// ---------------------------------------------------------------------------
// PromptDialog (small inline component used for rename/move/copy)
// ---------------------------------------------------------------------------

interface PromptDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly confirmLabel: string;
  readonly onConfirm: (value: string) => void;
}

function PromptDialog(props: PromptDialogProps): React.ReactElement {
  const { open, onOpenChange, title, defaultValue = "", placeholder, confirmLabel, onConfirm } = props;
  const [value, setValue] = useState(defaultValue);
  const titleId = useId();

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setValue(defaultValue);
        onOpenChange(next);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialog.Content
          aria-labelledby={titleId}
          className="fixed left-1/2 top-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 border border-border bg-background p-6 shadow-lg sm:rounded-lg"
        >
          <AlertDialog.Title id={titleId} className="text-lg font-semibold">
            {title}
          </AlertDialog.Title>
          <input
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cancel
              </button>
            </AlertDialog.Cancel>
            <button
              type="button"
              onClick={() => onConfirm(value)}
              disabled={value.trim().length === 0}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {confirmLabel}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
