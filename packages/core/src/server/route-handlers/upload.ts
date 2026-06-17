/**
 * `createUploadRouteHandler` — the Next.js Route Handler factory
 * for the presigned-URL upload flow.
 *
 * The client flow:
 *   1. Client POSTs `{ key, contentType, contentLength }` to this
 *      route (typically `/api/files/upload`).
 *   2. Route validates `contentLength` against `maxBytes` (413) and
 *      `contentType` against `allowedContentTypes` (415). No URL
 *      is signed on a rejected request.
 *   3. Route calls `fs.adapter.createPresignedUploadUrl({ key,
 *      contentType, expiresIn })` and returns `{ url, key,
 *      expiresAt }`.
 *   4. Client PUTs the file body to the signed URL (bypassing the
 *      Next.js server entirely).
 *
 * Spec scenarios: `route-handlers#1` (maxBytes), `route-handlers#2`
 * (allowedContentTypes).
 *
 * Construction-time validation: `expiresIn` is validated when the
 * factory is called (synchronous throw), per decision
 * `sdd/file-next/design/decision/expiresin-cap-timing`. A handler
 * built with `expiresIn: 30 * 86400` should never reach runtime —
 * the developer should see the error at server startup, not on
 * the first user request.
 */
import { FileSystemError } from "@/errors";
import type { FileSystem } from "@/storage/filesystem";

/** S3 SigV4 presign hard cap. The SDK itself rejects anything longer. */
const MAX_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;
/** Default 15 minutes — matches the adapter default and the AWS SDK default. */
const DEFAULT_EXPIRES_IN_SECONDS = 900;

/**
 * Convert a glob pattern (`image/*`) to a regex; convert a literal
 * (`image/png`) to an exact match. Both forms are common in
 * `allowedContentTypes` arrays.
 */
const matchesContentType = (pattern: string, actual: string): boolean => {
  if (pattern === actual) return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1); // "image/*" → "image/"
    return actual.startsWith(prefix);
  }
  return false;
};

export interface CreateUploadRouteHandlerOptions {
  readonly fs: FileSystem;
  /** Reject requests whose `contentLength` exceeds this. Omit for no cap. */
  readonly maxBytes?: number;
  /**
   * Reject requests whose `contentType` is not in this list.
   * Each entry is a literal (`image/png`) or a wildcard (`image/*`).
   * Omit for no restriction.
   */
  readonly allowedContentTypes?: ReadonlyArray<string>;
  /** Presigned URL lifetime in seconds. Default 900, max 7d (S3 SigV4). */
  readonly expiresIn?: number;
}

export interface UploadRouteHandlerRequest {
  key: string;
  contentType: string;
  contentLength: number;
}

export interface UploadRouteHandlerResult {
  url: string;
  key: string;
  expiresAt: string;
}

/**
 * Validate `expiresIn` against the S3 SigV4 hard cap. Throws
 * `FileSystemError(InternalError)` with `cause.code: "InvalidArgument"`
 * if the value is out of range. The top-level code stays in the
 * closed 11-code catalog; the specific reason lives on `cause`.
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
 * presigned upload URL after validating the request.
 */
export const createUploadRouteHandler = (
  opts: CreateUploadRouteHandlerOptions,
): ((req: Request) => Promise<Response>) => {
  const expiresIn = opts.expiresIn ?? DEFAULT_EXPIRES_IN_SECONDS;
  // Construction-time validation: fail-fast on misconfiguration.
  assertExpiresIn(expiresIn);

  return async (req: Request): Promise<Response> => {
    let body: UploadRouteHandlerRequest;
    try {
      body = (await req.json()) as UploadRouteHandlerRequest;
    } catch {
      return Response.json(
        { ok: false, error: { code: "InternalError", message: "Request body must be valid JSON" } },
        { status: 400 },
      );
    }

    // 1. maxBytes — reject BEFORE signing
    if (typeof opts.maxBytes === "number" && body.contentLength > opts.maxBytes) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "PayloadTooLarge",
            message: `contentLength ${body.contentLength} exceeds maxBytes ${opts.maxBytes}`,
          },
        },
        { status: 413 },
      );
    }

    // 2. allowedContentTypes — reject BEFORE signing
    if (opts.allowedContentTypes && opts.allowedContentTypes.length > 0) {
      const allowed = opts.allowedContentTypes.some((p) => matchesContentType(p, body.contentType));
      if (!allowed) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "UnsupportedMediaType",
              message: `contentType "${body.contentType}" is not in the allowed list`,
            },
          },
          { status: 415 },
        );
      }
    }

    // 3. Sign the URL (the only place the adapter is called)
    const r = await opts.fs.adapter.createPresignedUploadUrl({
      key: body.key as never,
      contentType: body.contentType,
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
      value: { url: r.value.url, key: body.key, expiresAt },
    });
  };
};
