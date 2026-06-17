"use client";

/**
 * `<ErrorState />` — error banner shown when a list / upload / action
 * fails. Built as a shadcn-style Alert.
 *
 * Spec:
 *   - Renders the error code in a monospace label and the message
 *     below.
 *   - Optional retry callback renders as a button on the right.
 *   - role="alert" so screen readers announce it.
 *
 * Architecture:
 *   - Pure presentational — no hook. The consumer catches errors
 *     from useFileBrowser / useUploader / useFileActions and passes
 *     them here.
 *   - Accepts either a FileSystemError object (from file-next) or
 *     a plain `{ code, message }` shape (for tests / mock data).
 */
import { AlertCircleIcon } from "lucide-react";
import type { FileSystemError } from "file-next";
import { cn } from "@/lib/cn";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ErrorStateProps {
  /** The error to display. */
  readonly error: FileSystemError | { code: string; message: string };
  /** Optional retry callback. When provided, renders a Retry button. */
  readonly onRetry?: () => void;
  /** Optional className. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ErrorState(props: ErrorStateProps): React.ReactElement {
  const { error, onRetry, className } = props;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm",
        className,
      )}
    >
      <AlertCircleIcon
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-destructive"
      />
      <div className="flex-1">
        <p className="font-medium text-destructive">
          {error.code}
          {error.code === "NetworkError" ? " — connection problem" : ""}
        </p>
        <p className="mt-1 text-muted-foreground">{error.message}</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
