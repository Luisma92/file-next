/**
 * `move` — implemented as `CopyObjectCommand` followed by
 * `DeleteObjectCommand`.
 *
 * S3 has no native rename primitive. The two-call dance is the
 * standard workaround. The order matters: copy FIRST, delete
 * ONLY if the copy succeeded. A copy failure leaves the source
 * intact (caller can retry); a delete failure after a successful
 * copy surfaces as a FileSystemError so the caller can clean up
 * the orphan destination themselves.
 *
 * v0.2 may add a true atomic move (e.g. via S3 Object Versioning
 * + lifecycle rules) for cases where the copy/delete window
 * is unacceptable.
 */
import type { S3Client } from "@aws-sdk/client-s3";
import { ok, err, type Result } from "@/types/result";
import { FileSystemError, fromAws } from "@/errors";
import { copyObject } from "./copy";
import { deleteObject } from "./delete";
import type { FileSystemConfig } from "../config";
import type { MoveInput, MoveOutput } from "../adapter";

export const moveObject = async (
  client: S3Client,
  config: FileSystemConfig,
  input: MoveInput,
): Promise<Result<MoveOutput, FileSystemError>> => {
  const copy = await copyObject(client, config, {
    sourceKey: input.sourceKey,
    destinationKey: input.destinationKey,
  });
  if (!copy.ok) {
    return err(copy.error);
  }

  const del = await deleteObject(client, config, { key: input.sourceKey });
  if (!del.ok) {
    return err(
      new FileSystemError({
        code: "InternalError",
        message: `Move succeeded the copy step but failed to delete the source (${input.sourceKey}). Destination (${input.destinationKey}) is now an orphan.`,
        retryable: false,
        cause: { code: del.error.code, message: del.error.message },
      }),
    );
  }

  return ok({});
};
