/**
 * `write` — single-PUT upload via `PutObjectCommand`.
 *
 * v0.1 cap: objects must be ≤ 5GB (S3 single-PUT hard limit).
 * Larger bodies return `PayloadTooLarge` (retryable: false) at
 * the adapter level so the consumer can chunk client-side or
 * wait for v0.2 server-side multipart. The cap is enforced
 * client-side for `Uint8Array` bodies; `ReadableStream` bodies
 * are sent as-is and the SDK will surface its own error if the
 * object is too big.
 *
 * The 5GB constant is exported as `MAX_SINGLE_PUT_SIZE` so the
 * tests and any future v0.2 multipart code can reference the
 * same number without magic strings.
 */
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { ok, err, type Result } from "@/types/result";
import { FileSystemError, fromAws } from "@/errors";
import type { FileSystemConfig } from "../config";
import type { WriteInput, WriteOutput } from "../adapter";

/** S3 single-PUT hard limit. */
export const MAX_SINGLE_PUT_SIZE = 5 * 1024 * 1024 * 1024;

export const writeObject = async (
  client: S3Client,
  config: FileSystemConfig,
  input: WriteInput,
): Promise<Result<WriteOutput, FileSystemError>> => {
  // Client-side cap for Uint8Array. Stream bodies are sent as-is;
  // S3 will reject oversized streams with its own error.
  if (input.body instanceof Uint8Array && input.body.byteLength > MAX_SINGLE_PUT_SIZE) {
    return err(
      new FileSystemError({
        code: "PayloadTooLarge",
        message: `Object body is ${input.body.byteLength} bytes; S3 single-PUT cap is ${MAX_SINGLE_PUT_SIZE} bytes. v0.1 does not support server-side multipart — chunk client-side or wait for v0.2.`,
        retryable: false,
      }),
    );
  }

  try {
    const res = await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: input.metadata,
      }),
    );
    return ok({
      etag: res.ETag ?? "",
      versionId: res.VersionId,
    });
  } catch (e) {
    return err(fromAws(e));
  }
};
