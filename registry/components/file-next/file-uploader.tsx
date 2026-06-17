"use client";

/**
 * `<FileUploader />` — a dropzone + button uploader with progress and cancel.
 *
 * Built on `useUploader` from `@file-next/headless`. The hook handles
 * the XHR + progress events + cancel logic; this component is a thin
 * presentational layer with:
 *   - A dropzone that accepts dragged files (calls upload() on drop).
 *   - A button (or the dropzone itself) that opens the native file picker.
 *   - A live progress bar during upload.
 *   - A cancel button visible during upload.
 *
 * Spec (registry#2 keyboard accessibility):
 *   - The dropzone is a button (focusable, Enter / Space to open picker).
 *   - aria-live="polite" announces upload start / completion.
 *   - The progress bar has role="progressbar" with aria-valuenow.
 *   - Cancel is a button labeled with the file name.
 *
 * Architecture:
 *   - The native file picker is triggered via a hidden <input type="file">.
 *   - Drop events are intercepted on the dropzone; we prevent default
 *     to stop the browser from opening the file in the tab.
 *   - The component is fully controlled by the hook; consumer passes
 *     `uploadUrl` + optional `confirmUpload` and reads the hook's return.
 */
import { useCallback, useRef, useState, type DragEvent } from "react";
import { UploadCloud as UploadCloudIcon, X as XIcon } from "lucide-react";
import { useUploader } from "@file-next/headless";
import { cn } from "@/lib/cn";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FileUploaderProps {
  /** The presigned URL to PUT/POST the file to. */
  readonly uploadUrl: string;
  /** Optional callback fired once the upload completes successfully. */
  readonly confirmUpload?: Parameters<typeof useUploader>[0]["confirmUpload"];
  /** Optional className for the dropzone. */
  readonly className?: string;
  /** Optional text shown in the dropzone. */
  readonly label?: string;
  /** Optional helper text shown below the label. */
  readonly description?: string;
  /** Accepted MIME types (e.g. "image/*"). Passed to the native input. */
  readonly accept?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileUploader(props: FileUploaderProps): React.ReactElement {
  const { uploadUrl, confirmUpload, className, label = "Upload a file", description = "Drag and drop or click to choose", accept } = props;
  const { upload, cancel, progress, status, error } = useUploader({ uploadUrl, confirmUpload });
  const [pickedFile, setPickedFile] = useState<{ name: string; size: number; type: string; content: Blob } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      const uploaderFile = {
        name: file.name,
        size: file.size,
        type: file.type,
        content: file,
      };
      setPickedFile(uploaderFile);
      upload(uploaderFile);
    },
    [upload],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onDragOver = useCallback((e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const onClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const isUploading = status === "uploading";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <button
        type="button"
        onClick={onClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        aria-label={label}
        aria-describedby="file-uploader-description"
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
          "hover:border-primary hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isDragOver ? "border-primary bg-accent" : "border-border",
          isUploading && "pointer-events-none opacity-60",
        )}
      >
        <UploadCloudIcon aria-hidden="true" className="size-8 text-muted-foreground" />
        <span className="font-medium">{label}</span>
        <span id="file-uploader-description" className="text-sm text-muted-foreground">
          {description}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={onInputChange}
        className="sr-only"
        tabIndex={-1}
      />
      <div role="status" aria-live="polite" className="min-h-5 text-sm">
        {status === "uploading" && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-card p-3">
            <div className="flex-1">
              <div className="flex items-center justify-between text-sm">
                <span className="truncate font-medium">
                  {pickedFile?.name ?? "Uploading…"}
                </span>
                <span className="ml-2 shrink-0 text-muted-foreground">{progress}%</span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={
                  pickedFile
                    ? `Upload progress for ${pickedFile.name}`
                    : "Upload progress"
                }
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={cancel}
              aria-label={
                pickedFile ? `Cancel upload of ${pickedFile.name}` : "Cancel upload"
              }
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <XIcon aria-hidden="true" className="size-4" />
            </button>
          </div>
        )}
        {status === "success" && (
          <p className="text-sm text-foreground">Upload complete.</p>
        )}
        {status === "aborted" && (
          <p className="text-sm text-muted-foreground">Upload canceled.</p>
        )}
        {status === "error" && (
          <p className="text-sm text-destructive" role="alert">
            Upload failed ({error?.code ?? "unknown"}).{" "}
            <button type="button" onClick={onClick} className="underline hover:no-underline">
              Try again
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
