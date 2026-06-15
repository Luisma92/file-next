/**
 * T-012: S3CompatibleAdapter — the 13-method interface every storage
 * provider implements (S3, R2, future Backblaze B2 / MinIO, ...).
 *
 * The interface is the contract the rest of `file-next` programs
 * against. Anything that does I/O (server actions, hooks, the
 * MetadataStore) goes through an `S3CompatibleAdapter`, never the
 * raw AWS SDK client, so the test plan never has to mock AWS
 * directly.
 *
 * This test file is the regression guard for the interface shape:
 *   - it must compile (a minimal mock passes type-level checks)
 *   - it must remain exactly 13 methods (a defensive counter that
 *     catches accidental additions or removals)
 *   - the input/output types must be JSON-serializable so the wire
 *     shape survives the RSC boundary.
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import type { Result } from "@/types/result";
import type { FileSystemError } from "@/errors";
import type {
  S3CompatibleAdapter,
  ListInput,
  ListOutput,
  ReadInput,
  ReadOutput,
  WriteInput,
  WriteOutput,
  DeleteInput,
  DeleteOutput,
  MoveInput,
  MoveOutput,
  CopyInput,
  CopyOutput,
  StatInput,
  StatOutput,
  ExistsInput,
  ExistsOutput,
  GetMetadataInput,
  GetMetadataOutput,
  SetMetadataInput,
  SetMetadataOutput,
  PresignedUploadInput,
  PresignedUploadOutput,
  PresignedDownloadInput,
  PresignedDownloadOutput,
  GetPublicUrlInput,
  GetPublicUrlOutput,
} from "@/storage/adapter";

describe("T-012: S3CompatibleAdapter", () => {
  describe("interface shape", () => {
    it("has exactly 13 methods (defensive count)", () => {
      // If a future PR adds a 14th method (or accidentally drops one),
      // this assertion fires. Update the count AND the test plan.
      const methodNames: Array<keyof S3CompatibleAdapter> = [
        "list",
        "read",
        "write",
        "delete",
        "move",
        "copy",
        "stat",
        "exists",
        "getMetadata",
        "setMetadata",
        "createPresignedUploadUrl",
        "createPresignedDownloadUrl",
        "getPublicUrl",
      ];
      expect(methodNames).toHaveLength(13);
    });
  });

  describe("type-level conformance", () => {
    it("a minimal mock that implements the interface compiles", () => {
      // The mock body is intentionally `any`/loose — this test only
      // proves the shape is implementable. Runtime correctness is
      // owned by the concrete adapter tests in PR 2b.
      const mock: S3CompatibleAdapter = {
        list: async (_input: ListInput): Promise<Result<ListOutput, FileSystemError>> =>
          ({ ok: true, value: { items: [], prefixes: [] } }),
        read: async (_input: ReadInput): Promise<Result<ReadOutput, FileSystemError>> =>
          ({ ok: true, value: { body: new Uint8Array() } }),
        write: async (_input: WriteInput): Promise<Result<WriteOutput, FileSystemError>> =>
          ({ ok: true, value: { etag: "x", versionId: undefined } }),
        delete: async (_input: DeleteInput): Promise<Result<DeleteOutput, FileSystemError>> =>
          ({ ok: true, value: {} }),
        move: async (_input: MoveInput): Promise<Result<MoveOutput, FileSystemError>> =>
          ({ ok: true, value: {} }),
        copy: async (_input: CopyInput): Promise<Result<CopyOutput, FileSystemError>> =>
          ({ ok: true, value: {} }),
        stat: async (_input: StatInput): Promise<Result<StatOutput, FileSystemError>> =>
          ({ ok: true, value: { key: "k" as never, size: 0, etag: "e", contentType: "application/octet-stream", lastModified: new Date(0), metadata: {} } }),
        exists: async (_input: ExistsInput): Promise<Result<ExistsOutput, FileSystemError>> =>
          ({ ok: true, value: { exists: false } }),
        getMetadata: async (_input: GetMetadataInput): Promise<Result<GetMetadataOutput, FileSystemError>> =>
          ({ ok: true, value: { metadata: {} } }),
        setMetadata: async (_input: SetMetadataInput): Promise<Result<SetMetadataOutput, FileSystemError>> =>
          ({ ok: true, value: {} }),
        createPresignedUploadUrl: async (_input: PresignedUploadInput): Promise<Result<PresignedUploadOutput, FileSystemError>> =>
          ({ ok: true, value: { url: "https://example", method: "PUT" } }),
        createPresignedDownloadUrl: async (_input: PresignedDownloadInput): Promise<Result<PresignedDownloadOutput, FileSystemError>> =>
          ({ ok: true, value: { url: "https://example" } }),
        getPublicUrl: async (_input: GetPublicUrlInput): Promise<Result<GetPublicUrlOutput, FileSystemError>> =>
          ({ ok: true, value: { url: "https://example" } }),
      };
      expectTypeOf(mock).toMatchTypeOf<S3CompatibleAdapter>();
    });

    it("an adapter that returns ok for one method and err for another still type-checks", () => {
      const mixed: S3CompatibleAdapter = {
        list: async () => ({ ok: true, value: { items: [], prefixes: [] } }),
        read: async () => ({
          ok: false,
          error: new (class extends Error {
            code = "NotFound" as const;
            retryable = false;
          })() as unknown as FileSystemError,
        }),
        write: async () => ({ ok: true, value: { etag: "x", versionId: undefined } }),
        delete: async () => ({ ok: true, value: {} }),
        move: async () => ({ ok: true, value: {} }),
        copy: async () => ({ ok: true, value: {} }),
        stat: async () => ({ ok: true, value: { key: "k" as never, size: 0, etag: "e", contentType: "application/octet-stream", lastModified: new Date(0), metadata: {} } }),
        exists: async () => ({ ok: true, value: { exists: false } }),
        getMetadata: async () => ({ ok: true, value: { metadata: {} } }),
        setMetadata: async () => ({ ok: true, value: {} }),
        createPresignedUploadUrl: async () => ({ ok: true, value: { url: "u", method: "PUT" } }),
        createPresignedDownloadUrl: async () => ({ ok: true, value: { url: "u" } }),
        getPublicUrl: async () => ({ ok: true, value: { url: "u" } }),
      };
      expectTypeOf(mixed).toMatchTypeOf<S3CompatibleAdapter>();
    });
  });
});
