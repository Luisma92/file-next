/**
 * `getPublicUrl` — build the public URL for an object in the bucket.
 *
 * No HTTP call. The URL is constructed from the bucket name +
 * key + (endpoint OR region) per S3's addressing rules.
 *
 * Provider-specific shapes:
 *   - **S3 (virtual-hosted, the default)**: `https://{bucket}.s3.{region}.amazonaws.com/{key}`
 *   - **S3 (path-style, when `forcePathStyle: true`)**: `https://{endpoint}/{bucket}/{key}` if an endpoint is set, else `https://s3.{region}.amazonaws.com/{bucket}/{key}`
 *   - **R2 (always path-style)**: `https://{endpoint}/{bucket}/{key}` (the `endpoint` is the R2 account endpoint)
 *
 * v0.1 does not support a per-bucket `customDomain` override
 * (the R2 custom-domain feature). Adding it is a one-line
 * schema change in `config.ts` + a branch in the URL builder
 * here; deferred to v0.2 per the spec.
 */
import type { S3Client } from "@aws-sdk/client-s3";
import { ok, type Result } from "@/types/result";
import type { FileSystemError } from "@/errors";
import type { FileSystemConfig } from "../config";
import type { GetPublicUrlInput, GetPublicUrlOutput } from "../adapter";

export const getPublicUrl = async (
  _client: S3Client,
  config: FileSystemConfig,
  input: GetPublicUrlInput,
): Promise<Result<GetPublicUrlOutput, FileSystemError>> => {
  const key = input.key;

  if (config.provider === "r2") {
    // R2: always path-style, always uses the account endpoint.
    return ok({ url: `${stripTrailingSlash(config.endpoint)}/${config.bucket}/${key}` });
  }

  if (config.forcePathStyle && config.endpoint) {
    return ok({ url: `${stripTrailingSlash(config.endpoint)}/${config.bucket}/${key}` });
  }

  if (config.forcePathStyle) {
    return ok({ url: `https://s3.${config.region}.amazonaws.com/${config.bucket}/${key}` });
  }

  // Default: S3 virtual-hosted style.
  return ok({ url: `https://${config.bucket}.s3.${config.region}.amazonaws.com/${key}` });
};

const stripTrailingSlash = (s: string): string =>
  s.endsWith("/") ? s.slice(0, -1) : s;
