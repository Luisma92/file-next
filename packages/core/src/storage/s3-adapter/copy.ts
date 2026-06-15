/**
 * `copy` — server-side copy via `CopyObjectCommand`.
 *
 * The `CopySource` field is `${bucket}/${key}` per S3's wire
 * format. We construct it from the parsed config's bucket so
 * cross-bucket copies can be added later (v0.2) by accepting a
 * `destinationBucket` field on the input.
 */
import { CopyObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { ok, err, type Result } from "@/types/result";
import { FileSystemError, fromAws } from "@/errors";
import type { FileSystemConfig } from "../config";
import type { CopyInput, CopyOutput } from "../adapter";

export const copyObject = async (
  client: S3Client,
  config: FileSystemConfig,
  input: CopyInput,
): Promise<Result<CopyOutput, FileSystemError>> => {
  try {
    await client.send(
      new CopyObjectCommand({
        Bucket: config.bucket,
        Key: input.destinationKey,
        CopySource: `${config.bucket}/${input.sourceKey}`,
      }),
    );
    return ok({});
  } catch (e) {
    return err(fromAws(e));
  }
};
