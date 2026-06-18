"use client";

/**
 * Tiny client component that calls the `createFile` server action
 * to populate the in-memory store. The page re-fetches on every
 * request (forced-dynamic), so creating a file shows up immediately
 * on refresh.
 */
import { useState, useTransition } from "react";
import { createDemoFile } from "./lib/demo-actions";

export function CreateSampleFileButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await createDemoFile();
            if (!result.ok) {
              setError(result.error.message);
            }
          });
        }}
        className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {isPending ? "Creating…" : "Create sample file"}
      </button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
