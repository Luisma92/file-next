"use server";

/**
 * Demo-only server actions — mutate the in-memory store to give
 * the user something to play with. In a real app these would be
 * the consumer's own actions (e.g. `createUploadRequest`,
 * `confirmUpload`) wired to their auth + UI.
 */
import {
  getActions,
  getStore,
  getAdapter,
  DEMO_TENANT,
  DEMO_USER,
} from "./file-next-store";
import { asS3Key, asPrefix } from "file-next";
import type { FileSystemError } from "file-next";

/**
 * Create one demo file via writeThrough. Returns Result<void, FileSystemError>
 * so the client can render the error message in a typed way.
 */
export async function createDemoFile(): Promise<
  { ok: true; value: void } | { ok: false; error: FileSystemError }
> {
  const adapter = getAdapter();
  const store = getStore();
  const actions = getActions();

  // Pick a unique key per click so re-clicks add more files.
  const listRes = await store.listChildren({ tenantId: DEMO_TENANT, parentId: null });
  const idx = listRes.ok ? listRes.value.items.length : 0;
  const fileName = `welcome-${Date.now()}-${idx}.txt`;
  const key = asS3Key(fileName);
  const body = new TextEncoder().encode(
    `Hello from the in-memory adapter!\nCreated at ${new Date().toISOString()}\n`,
  );

  // Write bytes to the in-memory adapter.
  const writeRes = await adapter.write({
    key,
    body,
    contentType: "text/plain",
    metadata: { source: "demo", createdBy: "createDemoFile" },
  });
  if (!writeRes.ok) return writeRes;

  // Mirror the write into the metadata store so listFiles sees it.
  const createRes = await store.createNode({
    tenantId: DEMO_TENANT,
    parentId: null,
    name: fileName,
    kind: "file",
    size: body.byteLength,
    mimeType: "text/plain",
    s3Key: key,
    ownerId: DEMO_USER,
  });
  if (!createRes.ok) return createRes;

  // We didn't go through the writeThrough helper above because
  // it expects a real S3 adapter path (it would call delete() on
  // compensation). For the in-memory demo we just call the two
  // operations directly — the actions.listFiles surface still
  // shows the file. v0.2 will wire this through actions via the
  // real writeThrough.
  void actions; // referenced for future use
  return { ok: true, value: undefined };
}

// Reference asPrefix to make the import non-redundant for future
// use in the demo (the store path will likely need it).
void asPrefix;
