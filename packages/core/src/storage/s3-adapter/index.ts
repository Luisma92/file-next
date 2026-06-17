/**
 * `createS3Adapter` — the factory that turns a validated
 * `FileSystemConfig` into a fully-shaped `S3CompatibleAdapter`.
 *
 * The 13 methods are wired as thin delegations to the per-method
 * helpers in the same directory. Each helper is independently
 * testable (one test file per method) and shares the S3Client
 * + the error-mapping via `fromAws`.
 *
 * The factory is consumed by `createFileSystem` (in
 * `../factory.ts`) which also owns the `forTenant` namespacing
 * and the (future) MetadataStore wiring. This file is
 * intentionally pure: it only knows about the adapter surface,
 * not the higher-level `FileSystem` container.
 */
import type { S3Client } from "@aws-sdk/client-s3";
import type {
  S3CompatibleAdapter,
} from "../adapter";
import type { FileSystemConfig } from "../config";
import { listObjects } from "./list";
import { readObject } from "./read";
import { statObject } from "./stat";
import { getMetadata } from "./get-metadata";
import { writeObject, MAX_SINGLE_PUT_SIZE } from "./write";
import { deleteObject } from "./delete";
import { existsObject } from "./exists";
import { copyObject } from "./copy";
import { moveObject } from "./move";
import { setMetadata } from "./set-metadata";
import {
  createPresignedUploadUrl,
  createPresignedDownloadUrl,
} from "./presigned";
import { getPublicUrl } from "./get-public-url";

export { MAX_SINGLE_PUT_SIZE };

/**
 * Build a `S3CompatibleAdapter` from a `FileSystemConfig`. The
 * `client` is the underlying `@aws-sdk/client-s3` S3Client; pass
 * the result of `createS3Client(config)` here.
 */
export const createS3Adapter = (
  client: S3Client,
  config: FileSystemConfig,
): S3CompatibleAdapter => ({
  list: (input) => listObjects(client, config, input),
  read: (input) => readObject(client, config, input),
  write: (input) => writeObject(client, config, input),
  delete: (input) => deleteObject(client, config, input),
  move: (input) => moveObject(client, config, input),
  copy: (input) => copyObject(client, config, input),
  stat: (input) => statObject(client, config, input),
  exists: (input) => existsObject(client, config, input),
  getMetadata: (input) => getMetadata(client, config, input),
  setMetadata: (input) => setMetadata(client, config, input),
  createPresignedUploadUrl: (input) => createPresignedUploadUrl(client, config, input),
  createPresignedDownloadUrl: (input) => createPresignedDownloadUrl(client, config, input),
  getPublicUrl: (input) => getPublicUrl(client, config, input),
});

// Re-exports for tests and downstream consumers who want to call
// the helpers directly (e.g. the server actions layer in PR 7).
export { listObjects } from "./list";
export { readObject } from "./read";
export { statObject } from "./stat";
export { getMetadata } from "./get-metadata";
export { writeObject } from "./write";
export { deleteObject } from "./delete";
export { existsObject } from "./exists";
export { copyObject } from "./copy";
export { moveObject } from "./move";
export { setMetadata } from "./set-metadata";
export {
  createPresignedUploadUrl,
  createPresignedDownloadUrl,
} from "./presigned";
export { getPublicUrl } from "./get-public-url";
export { createS3Client } from "./client";
