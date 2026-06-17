"use client";

/**
 * `<EmptyState />` — placeholder shown when a folder has no children.
 *
 * Spec:
 *   - Centered icon + title + description + optional action button.
 *   - Renders inside a shadcn-style Empty container (centered,
 *     border-dashed, muted background).
 *
 * Architecture:
 *   - Pure presentational — no hook. The consumer decides WHEN to
 *     show this (typically when `files.length === 0`).
 *   - The `action` slot accepts any React node — usually a Button.
 */
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/cn";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  /** Title (e.g. "No files yet"). */
  readonly title: string;
  /** Description (e.g. "Upload a file to get started."). */
  readonly description?: string;
  /** Optional icon (defaults to lucide Inbox). */
  readonly icon?: ReactNode;
  /** Optional action button or link. */
  readonly action?: ReactNode;
  /** Optional className. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EmptyState(props: EmptyStateProps): React.ReactElement {
  const { title, description, icon, action, className } = props;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 p-8 text-center",
        className,
      )}
    >
      <div className="rounded-full bg-background p-3 text-muted-foreground shadow-sm">
        {icon ?? <Inbox aria-hidden="true" className="size-6" />}
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
