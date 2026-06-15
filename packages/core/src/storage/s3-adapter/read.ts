/**
 * `read` — fetch an object's body as a `Uint8Array`.
 *
 * Uses `GetObjectCommand` (a body-bearing S3 call). The wire
 * response has a `Body` field that is an SDK-readable stream;
 * we collect it into a single `Uint8Array` for the consumer
 * (small-to-medium objects only; v0.1 does NOT support range
 * reads into a streaming consumer — that lands when the headless
 * `useUploader`/`useDownloadProgress` hooks need it for
 * progress reporting).
 *
 * Provider-agnostic: any S3-compatible client works.
 */
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { ok, err, type Result } from "@/types/result";
import { FileSystemError, fromAws } from "@/errors";
import type { FileSystemConfig } from "../config";
import type { ReadInput, ReadOutput } from "../adapter";

/** Collect an SDK stream body into a single Uint8Array. */
const streamToBytes = async (body: unknown): Promise<Uint8Array> => {
  // The SDK returns a web ReadableStream-shaped object that ALSO
  // implements AsyncIterable (it's a Readable.from(Buffer)). The
  // safest cross-runtime path is to drain it via async iteration.
  const chunks: Uint8Array[] = [];
  // The SDK body is a "SdkStream" which is AsyncIterable<Uint8Array>.
  // node:stream Readable is also async-iterable.
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
};

export const readObject = async (
  client: S3Client,
  config: FileSystemConfig,
  input: ReadInput,
): Promise<Result<ReadOutput, FileSystemError>> => {
  try {
    const res = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: input.key,
        Range: input.range,
      }),
    );
    if (!res.Body) {
      return err(
        new FileSystemError({
          code: "InternalError",
          message: "S3 returned a GetObject response with no body",
          retryable: false,
        }),
      );
    }
    const body = await streamToBytes(res.Body);
    return ok({
      body,
      contentType: res.ContentType,
      metadata: res.Metadata,
    });
  } catch (e) {
    return err(fromAws(e));
  }
};
