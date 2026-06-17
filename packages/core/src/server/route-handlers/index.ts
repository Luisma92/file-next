/**
 * Barrel re-export for the 2 route-handler factories.
 *
 * The factories themselves live in `./upload.ts` and `./download.ts`.
 * This file is the single import point for the route-handler layer
 * (mirrors how `packages/core/src/server/index.ts` re-exports the
 * 5 server actions from `./actions.ts`).
 */
export { createUploadRouteHandler } from "./upload";
export type {
  CreateUploadRouteHandlerOptions,
  UploadRouteHandlerRequest,
  UploadRouteHandlerResult,
} from "./upload";
export { createDownloadRouteHandler } from "./download";
export type {
  CreateDownloadRouteHandlerOptions,
  DownloadRouteHandlerResult,
} from "./download";
