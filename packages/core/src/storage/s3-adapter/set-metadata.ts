/**
 * `setMetadata` — replace (or merge) the user-defined metadata on
 * an existing object.
 *
 * S3 has no native PATCH-metadata primitive. The standard
 * workaround is a self-`CopyObject` with `Metadata` set to the
 * new value and `MetadataDirective: "REPLACE"` (replace) or
 * "COPY" (merge). The body is re-uploaded by S3 server-side so
 * this is bandwidth-free for the consumer.
 *
 * If `replace === false` (default), the new metadata MERGES with
 * the existing user metadata (later wins on key conflict). If
 * `replace === true`, the new metadata REPLACES it entirely.
 *
 * Missing key returns NotFound.
 */
import { CopyObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { ok, err, type Result } from "@/types/result";
import { FileSystemError, fromAws } from "@/errors";
import type { FileSystemConfig } from "../config";
import type { SetMetadataInput, SetMetadataOutput } from "../adapter";

export const setMetadata = async (
  client: S3Client,
  config: FileSystemConfig,
  input: SetMetadataInput,
): Promise<Result<SetMetadataOutput, FileSystemError>> => {
  try {
    await client.send(
      new CopyObjectCommand({
        Bucket: config.bucket,
        Key: input.key,
        CopySource: `${config.bucket}/${input.key}`,
        Metadata: input.metadata,
        MetadataDirective: input.replace ? "REPLACE" : "COPY",
      }),
    );
    return ok({});
  } catch (e) {
    return err(fromAws(e));
  }
};
