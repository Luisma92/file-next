/**
 * Server-side entry point.
 *
 * The consumer MUST add `import "server-only"` to their own
 * server module that re-exports from this file. The library
 * doesn't include the import here because it would break the
 * unit test environment (server-only throws when not in a
 * Server Component context).
 *
 * Consumer pattern:
 *
 *   // app/actions.ts
 *   'use server';
 *   import "server-only";
 *   import { listFilesAction } from 'file-next/server';
 *   export { listFilesAction };
 *
 * The `import "server-only"` ensures the module is only bundled
 * by the Next.js server build. A careless import from a client
 * component fails the build with a clear error.
 */
export { createServerActions } from "./actions";
export type { ServerActionsDeps, ListFilesOutput } from "./actions";
export {
  ListFilesInputSchema,
  DeleteFileInputSchema,
  MoveFileInputSchema,
  CopyFileInputSchema,
  SetMetadataInputSchema,
} from "./actions";
// withAuth + RequestContext are re-exported from the main
// "file-next" entry (no need to be in the server-only module).
