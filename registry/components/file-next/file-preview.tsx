"use client";

/**
 * `<FilePreview />` — image preview for image MIME types, lucide
 * icon for everything else.
 *
 * Spec:
 *   - If `mimeType` starts with "image/", renders an `<img>` with
 *     the given URL and alt text.
 *   - Otherwise renders a lucide FileText icon (sized by file size).
 *   - Has role="img" + aria-label for non-image previews.
 *
 * Architecture:
 *   - Pure presentational — no hook. Consumer owns the resolved
 *     URL and the MIME type.
 *   - For v0.1 we don't load the image; we just render the URL.
 *     Consumers should pre-resolve the URL via useFileUrl if
 *     they want signed-URL support.
 */
import { FileText, ImageIcon } from "lucide-react";
import { cn } from "@/lib/cn";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FilePreviewProps {
  /** The MIME type of the file (e.g. "image/png", "application/pdf"). */
  readonly mimeType: string;
  /** The URL to preview. Required when mimeType is an image. */
  readonly url?: string;
  /** Alt text for image previews. */
  readonly alt?: string;
  /** Optional className. */
  readonly className?: string;
  /** Optional explicit size for the icon (px). Default 48. */
  readonly iconSize?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FilePreview(props: FilePreviewProps): React.ReactElement {
  const { mimeType, url, alt = "", className, iconSize = 48 } = props;

  if (mimeType.startsWith("image/")) {
    if (!url) {
      return (
        <div
          role="img"
          aria-label={alt || "Image preview not available"}
          className={cn(
            "flex items-center justify-center rounded-md border border-dashed bg-muted text-muted-foreground",
            className,
          )}
          style={{ width: iconSize, height: iconSize }}
        >
          <ImageIcon aria-hidden="true" style={{ width: iconSize / 2, height: iconSize / 2 }} />
        </div>
      );
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={alt}
        className={cn("rounded-md object-cover", className)}
        style={{ width: iconSize, height: iconSize }}
      />
    );
  }

  return (
    <div
      role="img"
      aria-label={alt || `${mimeType} preview`}
      className={cn(
        "flex items-center justify-center rounded-md bg-muted text-muted-foreground",
        className,
      )}
      style={{ width: iconSize, height: iconSize }}
    >
      <FileText aria-hidden="true" style={{ width: iconSize / 2, height: iconSize / 2 }} />
    </div>
  );
}
