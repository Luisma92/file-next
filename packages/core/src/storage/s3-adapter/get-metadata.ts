/**
 * `getMetadata` — fetch just the user-defined metadata.
 *
 * S3's `HeadObject` returns size, etag, contentType, lastModified,
 * AND user metadata in one call. `getMetadata` runs the same HEAD
 * and returns only the user-metadata subset so callers that only
 * care about application-level tags don't have to thread the rest
 * of the HEAD shape through their code.
 *
 * For callers that need the full HEAD shape, use `stat` instead.
 */
import { HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { ok, err, type Result } from "@/types/result";
import { FileSystemError, fromAws } from "@/errors";
import type { FileSystemConfig } from "../config";
import type { GetMetadataInput, GetMetadataOutput } from "../adapter";

export const getMetadata = async (
  client: S3Client,
  config: FileSystemConfig,
  input: GetMetadataInput,
): Promise<Result<GetMetadataOutput, FileSystemError>> => {
  try {
    const res = await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: input.key,
      }),
    );
    return ok(res.Metadata ?? {});
  } catch (e) {
    return err(fromAws(e));
  }
};
