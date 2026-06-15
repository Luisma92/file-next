/**
 * `list` — the S3-compatible adapter method that lists objects
 * under a prefix with optional `delimiter` (for "folder" emulation)
 * and paginated `continuationToken` support.
 *
 * The wire is the S3 `ListObjectsV2` command, which all S3-compatible
 * providers (AWS S3, Cloudflare R2, Backblaze B2, MinIO) implement
 * with the same shape. The only thing that differs between providers
 * is the `S3Client` config (endpoint, forcePathStyle) — handled by
 * the `client.ts` helper, not here.
 *
 * Error mapping:
 *   - `NoSuchBucket`  -> NotFound (the bucket itself is gone)
 *   - network/timeout -> NetworkError (retryable: true)
 *   - everything else -> fromAws (uses the catalog mappers; preserves
 *     the upstream `cause.code` for debugging)
 */
import { ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import { ok, err, type Result } from "@/types/result";
import { FileSystemError, fromAws } from "@/errors";
import { asS3Key, asPrefix } from "@/types/branded";
import type { FileSystemConfig } from "../config";
import type { ListInput, ListOutput } from "../adapter";

export const listObjects = async (
  client: S3Client,
  config: FileSystemConfig,
  input: ListInput,
): Promise<Result<ListOutput, FileSystemError>> => {
  try {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: input.prefix,
        ContinuationToken: input.continuationToken,
        MaxKeys: input.limit,
        Delimiter: input.delimiter,
      }),
    );
    return ok({
      items: (res.Contents ?? []).map((c) => ({
        key: asS3Key(c.Key ?? ""),
        size: c.Size ?? 0,
        lastModified: c.LastModified ?? new Date(0),
      })),
      prefixes: (res.CommonPrefixes ?? []).map((p) => asPrefix(p.Prefix ?? "")),
      nextContinuationToken: res.NextContinuationToken,
    });
  } catch (e) {
    return err(fromAws(e));
  }
};
