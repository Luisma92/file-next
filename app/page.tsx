import { getActions, DEMO_TENANT, DEMO_USER } from "./lib/file-next-store";
import { CreateSampleFileButton } from "./CreateSampleFileButton";

/**
 * Demo home page — server component that lists files in the demo
 * tenant's root using the library's `listFiles` server action.
 *
 * `dynamic = "force-dynamic"` opts out of Next.js' static rendering
 * so every request re-runs `listFiles` against the live in-memory
 * store. The page reflects new files immediately after the user
 * clicks the "Create sample file" button + refreshes.
 */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const actions = getActions();
  const result = await actions.listFiles({
    tenantId: DEMO_TENANT,
    parentId: null,
  });

  return (
    <main className="container mx-auto flex min-h-screen flex-col gap-6 py-12">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">file-next</h1>
        <p className="text-muted-foreground">
          v0.2 demo — running entirely on the in-memory adapter. Refresh to
          re-fetch. (Nothing persists across server restarts; for real S3
          + Postgres, see <code>docs/provider-setup.md</code>.)
        </p>
      </header>

      {result.ok ? (
        <FilesPanel
          count={result.value.items.length}
          fileNames={result.value.items.map((item) => item.name)}
        />
      ) : (
        <ErrorPanel error={result.error} />
      )}

      <CreateSampleFileButton />
    </main>
  );
}

interface FileItem {
  readonly name: string;
}

function FilesPanel({
  count,
  fileNames,
}: {
  count: number;
  fileNames: ReadonlyArray<string>;
}) {
  void ({} as FileItem); // keep the type import alive for future use
  return (
    <section
      data-testid="files-panel"
      className="rounded-lg border border-border bg-card p-6"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Files in root</h2>
        <span className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
          {count} {count === 1 ? "file" : "files"}
        </span>
      </div>
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">
          No files yet. The in-memory store starts empty.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {fileNames.map((name: string) => (
            <li
              key={name}
              data-testid="file-row"
              className="flex items-center gap-2 py-2 text-sm"
            >
              <span className="font-medium">{name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ErrorPanel({ error }: { error: { code: string; message: string } }) {
  return (
    <section
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm"
    >
      <p className="font-medium text-destructive">listFiles failed: {error.code}</p>
      <p className="mt-1 text-muted-foreground">{error.message}</p>
    </section>
  );
}
