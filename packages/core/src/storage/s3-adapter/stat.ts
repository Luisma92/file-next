/**
 * `stat` — cheap metadata fetch via `HeadObjectCommand`.
 *
 * Returns the full HEAD response (size, etag, contentType,
 * lastModified, user metadata) in one typed object. Distinct
 * from `getMetadata` (which returns just the user-metadata
 * subset) so callers can choose between the cheap-and-typed
 * shape they need.
 */
import { HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { ok, err, type Result } from "@/types/result";
import { FileSystemError, fromAws } from "@/errors";
import type { FileSystemConfig } from "../config";
import type { StatInput, StatOutput } from "../adapter";

export const statObject = async (
  client: S3Client,
  config: FileSystemConfig,
  input: StatInput,
): Promise<Result<StatOutput, FileSystemError>> => {
  try {
    const res = await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: input.key,
      }),
    );
    return ok({
      key: input.key,
      size: res.ContentLength ?? 0,
      etag: res.ETag ?? "",
      contentType: res.ContentType ?? "application/octet-stream",
      lastModified: res.LastModified ?? new Date(0),
      metadata: res.Metadata ?? {},
    });
  } catch (e) {
    return err(fromAws(e));
  }
};
