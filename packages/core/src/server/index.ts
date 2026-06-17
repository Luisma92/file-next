/**
 * Testable server entry point.
 *
 * This module re-exports the 5 server actions (PR 7a) and the 2
 * route-handler factories (PR 7b). It is the import target for
 * the library's own tests — kept free of `import "server-only"`
 * so vitest can evaluate the module under jsdom without throwing.
 *
 * The CONSUMER-facing server entry is `server/entry.ts` (the
 * `./server` package.json subpath), which has `import "server-only"`
 * at the top. The split lets the test suite import the factories
 * freely while the published bundle refuses to be pulled into a
 * client component.
 *
 * Consumer pattern (in a Next.js app):
 *
 *   // app/api/upload/route.ts
 *   import { createUploadRouteHandler } from "file-next/server";
 *   import { getFileSystem } from "file-next";
 *   export const POST = createUploadRouteHandler({
 *     fs: getFileSystem(),
 *     maxBytes: 25 * 1024 * 1024,
 *     allowedContentTypes: ["image/*"],
 *   });
 *
 *   // app/actions.ts
 *   "use server";
 *   import { listFilesAction } from "file-next/server";
 *   export { listFilesAction };
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
export {
  createUploadRouteHandler,
  createDownloadRouteHandler,
} from "./route-handlers";
export type {
  CreateUploadRouteHandlerOptions,
  UploadRouteHandlerRequest,
  UploadRouteHandlerResult,
  CreateDownloadRouteHandlerOptions,
  DownloadRouteHandlerResult,
} from "./route-handlers";
// withAuth + RequestContext are re-exported from the main
// "file-next" entry (no need to be in the server-only module).
