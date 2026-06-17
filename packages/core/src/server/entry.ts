/**
 * `file-next/server` — the published server subpath entry.
 *
 * The first line `import "server-only"` is the load-bearing
 * instruction. Next.js 15 bundles this module only on the server;
 * a careless import from a `"use client"` component fails the
 * build with a `server-only` violation (spec scenario
 * `distribution#1`).
 *
 * The `server-only` package is an unconditional throw on import —
 * see https://nextjs.org/docs/app/building-your-application/rendering/composition-patterns
 * — so this module is NEVER imported by the library's own tests
 * (which run in jsdom). The testable surface lives in
 * `./index.ts` (no `import "server-only"`); this file is the
 * thin, server-only wrapper.
 */
import "server-only";

export {
  createServerActions,
  createUploadRouteHandler,
  createDownloadRouteHandler,
} from "./index";

export type {
  ServerActionsDeps,
  ListFilesOutput,
  CreateUploadRouteHandlerOptions,
  UploadRouteHandlerRequest,
  UploadRouteHandlerResult,
  CreateDownloadRouteHandlerOptions,
  DownloadRouteHandlerResult,
} from "./index";
