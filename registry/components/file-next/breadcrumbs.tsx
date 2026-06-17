"use client";

/**
 * `<Breadcrumbs />` — folder path segments with click-to-navigate.
 *
 * Spec:
 *   - Renders the path as a list of segments separated by `/`.
 *   - Each segment (except the last, the current folder) is a button
 *     that calls `onNavigate(segment)`.
 *   - The last segment is plain text marked aria-current="page".
 *   - aria-label="Breadcrumb" on the nav element.
 *
 * Architecture:
 *   - Pure presentational — no hook needed. The consumer owns the
 *     navigation state (this is a thin wrapper that renders the path
 *     string).
 *   - Keyboard accessible: buttons are focusable, Enter / Space
 *     activate them.
 */
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BreadcrumbsProps {
  /** Ordered list of path segments from root to current folder. */
  readonly segments: ReadonlyArray<{ id: string; name: string }>;
  /** Called when a segment is activated. */
  readonly onNavigate?: (segment: { id: string; name: string }) => void;
  /** Optional className for the nav element. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Breadcrumbs(props: BreadcrumbsProps): React.ReactElement {
  const { segments, onNavigate, className } = props;

  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center gap-1 text-sm", className)}>
      <ol className="flex flex-wrap items-center gap-1">
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          return (
            <li key={segment.id} className="flex items-center gap-1">
              {isLast ? (
                <span aria-current="page" className="font-medium text-foreground">
                  {segment.name}
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onNavigate?.(segment)}
                    className="rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {segment.name}
                  </button>
                  <ChevronRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
