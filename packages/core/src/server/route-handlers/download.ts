/**
 * `createDownloadRouteHandler` — the Next.js Route Handler factory
 * for the presigned-URL download flow.
 *
 * The client flow:
 *   1. Client GETs `/api/files/download?key=uploads/report.pdf`.
 *   2. Route calls `fs.adapter.createPresignedDownloadUrl({ key,
 *      expiresIn })` and returns `{ url, expiresAt }`.
 *   3. Client GETs the signed URL (bypassing the Next.js server).
 *
 * Spec scenario: `route-handlers#3` — `X-Amz-Expires=900` is present
 * in the signed URL and `expiresAt` is `now + 900s`.
 *
 * Construction-time validation: same `expiresIn` policy as the
 * upload handler (see `expiresin-cap-timing` decision). The cap
 * lives at the factory level, not the adapter, so a misconfigured
 * handler fails fast at server startup.
 */
import { FileSystemError } from "@/errors";
import type { FileSystem } from "@/storage/filesystem";

/** S3 SigV4 presign hard cap. The SDK itself rejects anything longer. */
const MAX_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;
/** Default 15 minutes — matches the adapter default and the AWS SDK default. */
const DEFAULT_EXPIRES_IN_SECONDS = 900;

export interface CreateDownloadRouteHandlerOptions {
  readonly fs: FileSystem;
  /** Presigned URL lifetime in seconds. Default 900, max 7d (S3 SigV4). */
  readonly expiresIn?: number;
}

export interface DownloadRouteHandlerResult {
  url: string;
  expiresAt: string;
}

/**
 * Validate `expiresIn` against the S3 SigV4 hard cap. Throws
 * `FileSystemError(InternalError)` with `cause.code: "InvalidArgument"`
 * if the value is out of range.
 */
const assertExpiresIn = (expiresIn: number): void => {
  if (!Number.isFinite(expiresIn) || expiresIn < 1 || expiresIn > MAX_EXPIRES_IN_SECONDS) {
    throw new FileSystemError({
      code: "InternalError",
      message: `expiresIn must be between 1 and ${MAX_EXPIRES_IN_SECONDS} seconds (S3 SigV4 limit)`,
      retryable: false,
      cause: { code: "InvalidArgument", message: `expiresIn=${expiresIn}` },
    });
  }
};

/**
 * Build a Next.js Route Handler `(req) => Response` that signs a
 * presigned GET URL.
 *
 * The `key` is read from the `?key=` query param. The handler does
 * NOT do any body / content-type / size validation (downloads
 * don't have those concerns); the only chokepoint is the
 * construction-time `expiresIn` cap.
 */
export const createDownloadRouteHandler = (
  opts: CreateDownloadRouteHandlerOptions,
): ((req: Request) => Promise<Response>) => {
  const expiresIn = opts.expiresIn ?? DEFAULT_EXPIRES_IN_SECONDS;
  assertExpiresIn(expiresIn);

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (!key) {
      return Response.json(
        { ok: false, error: { code: "InternalError", message: "Missing required query param: key" } },
        { status: 400 },
      );
    }

    const r = await opts.fs.adapter.createPresignedDownloadUrl({
      key: key as never,
      expiresIn,
    });
    if (!r.ok) {
      return Response.json(
        { ok: false, error: { code: r.error.code, message: r.error.message } },
        { status: 500 },
      );
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    return Response.json({
      ok: true,
      value: { url: r.value.url, expiresAt },
    });
  };
};
