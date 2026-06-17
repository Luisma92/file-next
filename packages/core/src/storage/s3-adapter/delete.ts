/**
 * `delete` — remove an object from the bucket.
 *
 * Missing keys are idempotent: S3 returns success even if the
 * key did not exist, so we don't need to special-case the 404.
 * That means a "delete that found nothing" still returns ok
 * (caller's intent was "make sure this key is gone" — and it is).
 */
import { DeleteObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { ok, err, type Result } from "@/types/result";
import { FileSystemError, fromAws } from "@/errors";
import type { FileSystemConfig } from "../config";
import type { DeleteInput, DeleteOutput } from "../adapter";

export const deleteObject = async (
  client: S3Client,
  config: FileSystemConfig,
  input: DeleteInput,
): Promise<Result<DeleteOutput, FileSystemError>> => {
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: input.key,
      }),
    );
    return ok({});
  } catch (e) {
    return err(fromAws(e));
  }
};
