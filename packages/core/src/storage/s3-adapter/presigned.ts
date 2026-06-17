/**
 * `createPresignedUploadUrl` + `createPresignedDownloadUrl` —
 * sign a URL the client can use to PUT/GET the object directly,
 * bypassing the Next.js server entirely.
 *
 * Why this exists: large file uploads (> 1MB Server Action body
 * limit, often > 100MB in practice) MUST go directly from the
 * browser to the storage provider. The server signs the URL,
 * returns it to the client, the client does the PUT itself, and
 * then the server action confirms the upload via the metadata
 * store.
 *
 * NOTE: this adapter method does NOT cap \`expiresIn\`. The 7-day
 * S3 SigV4 cap is enforced at the route-handler-factory level
 * (PR 7b) so the adapter stays a low-level pass-through and
 * library consumers who need the cap have a single chokepoint
 * to configure. See
 * \`sdd/file-next/design/decision/expiresin-cap-timing\`.
 */
import { PutObjectCommand, GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ok, err, type Result } from "@/types/result";
import { FileSystemError, fromAws } from "@/errors";
import type { FileSystemConfig } from "../config";
import type {
  PresignedUploadInput,
  PresignedUploadOutput,
  PresignedDownloadInput,
  PresignedDownloadOutput,
} from "../adapter";

export const createPresignedUploadUrl = async (
  client: S3Client,
  config: FileSystemConfig,
  input: PresignedUploadInput,
): Promise<Result<PresignedUploadOutput, FileSystemError>> => {
  try {
    const cmd = new PutObjectCommand({
      Bucket: config.bucket,
      Key: input.key,
      ContentType: input.contentType,
    });
    const url = await getSignedUrl(client, cmd, { expiresIn: input.expiresIn ?? 900 });
    return ok({ url, method: "PUT" });
  } catch (e) {
    return err(fromAws(e));
  }
};

export const createPresignedDownloadUrl = async (
  client: S3Client,
  config: FileSystemConfig,
  input: PresignedDownloadInput,
): Promise<Result<PresignedDownloadOutput, FileSystemError>> => {
  try {
    const cmd = new GetObjectCommand({
      Bucket: config.bucket,
      Key: input.key,
    });
    const url = await getSignedUrl(client, cmd, { expiresIn: input.expiresIn ?? 900 });
    return ok({ url });
  } catch (e) {
    return err(fromAws(e));
  }
};
