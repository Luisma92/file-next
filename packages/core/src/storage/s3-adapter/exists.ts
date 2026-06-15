/**
 * `exists` — boolean presence check via `HeadObjectCommand`.
 *
 * This is the ONE method where "key not found" is NOT an error.
 * A missing key returns `ok({ exists: false })`; other S3
 * failures (AccessDenied, networking, ...) still return
 * `err(FileSystemError)`. The special-case 404 handling is
 * centralized here so the rest of the codebase can treat
 * `exists` as a pure boolean query.
 */
import { HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { ok, err, type Result } from "@/types/result";
import { FileSystemError, fromAws } from "@/errors";
import type { FileSystemConfig } from "../config";
import type { ExistsInput, ExistsOutput } from "../adapter";

export const existsObject = async (
  client: S3Client,
  config: FileSystemConfig,
  input: ExistsInput,
): Promise<Result<ExistsOutput, FileSystemError>> => {
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: input.key,
      }),
    );
    return ok({ exists: true });
  } catch (e) {
    // Special case: a 404 on HEAD is a boolean "no", not an error.
    const err_ = fromAws(e);
    if (err_.code === "NotFound") {
      return ok({ exists: false });
    }
    return err(err_);
  }
};
