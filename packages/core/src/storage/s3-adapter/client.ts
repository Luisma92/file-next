/**
 * `createS3Client` — turn a validated `FileSystemConfig` into a
 * configured `@aws-sdk/client-s3` `S3Client`.
 *
 * This is the ONLY place that knows the provider-specific knobs
 * (endpoint, forcePathStyle, region) for the client construction.
 * The adapter methods themselves are provider-agnostic; they
 * just call `client.send(command)` and the client handles routing.
 *
 * Provider-specific notes:
 *   - **S3**: `region` is the AWS region. `endpoint` is optional
 *     and only set for S3-compatible providers (MinIO,
 *     LocalStack). `forcePathStyle` defaults to false (virtual-
 *     hosted) but can be flipped to true for MinIO compatibility.
 *   - **R2**: the SDK requires a `region` value but R2 ignores
 *     it; we use the conventional "auto". `endpoint` is the
 *     account-specific Cloudflare R2 endpoint (required). R2
 *     ONLY supports path-style addressing; the `R2ConfigSchema`
 *     type enforces `forcePathStyle: true` at the type level.
 */
import { S3Client } from "@aws-sdk/client-s3";
import type { FileSystemConfig, S3Config, R2Config } from "../config";

export const createS3Client = (config: FileSystemConfig): S3Client => {
  if (config.provider === "r2") {
    return buildClient({
      region: "auto",
      endpoint: config.endpoint,
      credentials: config.credentials,
      forcePathStyle: true,
    });
  }
  return buildClient({
    region: config.region,
    endpoint: config.endpoint,
    credentials: config.credentials,
    forcePathStyle: config.forcePathStyle,
  });
};

const buildClient = (opts: {
  region: string;
  endpoint: string | undefined;
  credentials: { accessKeyId: string; secretAccessKey: string };
  forcePathStyle: boolean;
}): S3Client => {
  return new S3Client({
    region: opts.region,
    endpoint: opts.endpoint,
    credentials: opts.credentials,
    forcePathStyle: opts.forcePathStyle,
  });
};

// Re-export the config types so adapter consumers can type-narrow
// without a second import.
export type { S3Config, R2Config };
