/**
 * `createFileSystem(config)` — the factory that turns a validated
 * `FileSystemConfig` into a fully-shaped `FileSystem`.
 *
 * The factory is the only place that decides which concrete adapter
 * implementation to instantiate. Everything downstream of it (the
 * env-singleton in T-011, server actions, hooks) goes through
 * `createFileSystem` so the provider choice is made exactly once.
 *
 * For PR 2a the factory returns:
 *   - a **stub adapter** (satisfies `S3CompatibleAdapter`, every
 *     method returns `Result.err(InternalError)` with message
 *     "not implemented"). The 13 methods are typed and present so
 *     the rest of the codebase can be wired up against the shape
 *     before the real implementation lands.
 *   - the config as-is (immutable view)
 *   - `metadata: undefined` (the metadata index lands in a later PR)
 *   - a no-op `forTenant` chain (the real per-tenant namespacing
 *     lands in PR 3)
 *
 * Validation contract: the factory re-runs `parseFileSystemConfig`
 * on its input and **throws** (not returns) a `FileSystemError` on
 * invalid input. The env-singleton (T-011) is the layer that
 * converts a thrown error into a startup failure; the factory
 * itself trusts the input type and only validates as a defensive
 * net.
 */
import { err, type Result } from "@/types/result";
import { FileSystemError } from "@/errors";
import type { FileSystem } from "./filesystem";
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
} from "./adapter";
import { parseFileSystemConfig, type FileSystemConfig } from "./config";

/**
 * PR 2a placeholder adapter. Satisfies `S3CompatibleAdapter` so the
 * rest of the codebase (factory, singleton, server actions) can be
 * wired up against the shape, but every method returns
 * `Result.err(InternalError)` with a clear "not implemented" tag.
 *
 * Marked clearly as a stub — DO NOT use for real I/O. The concrete
 * S3 and R2 adapters land in PR 2b.
 */
const createStubAdapter = (): S3CompatibleAdapter => {
  const notImplemented = (): Result<never, FileSystemError> =>
    err(
      new FileSystemError({
        code: "InternalError",
        message: "not implemented: stub adapter (PR 2a placeholder)",
        retryable: false,
      }),
    );

  return {
    list: async (_input: ListInput): Promise<Result<ListOutput, FileSystemError>> => notImplemented(),
    read: async (_input: ReadInput): Promise<Result<ReadOutput, FileSystemError>> => notImplemented(),
    write: async (_input: WriteInput): Promise<Result<WriteOutput, FileSystemError>> => notImplemented(),
    delete: async (_input: DeleteInput): Promise<Result<DeleteOutput, FileSystemError>> => notImplemented(),
    move: async (_input: MoveInput): Promise<Result<MoveOutput, FileSystemError>> => notImplemented(),
    copy: async (_input: CopyInput): Promise<Result<CopyOutput, FileSystemError>> => notImplemented(),
    stat: async (_input: StatInput): Promise<Result<StatOutput, FileSystemError>> => notImplemented(),
    exists: async (_input: ExistsInput): Promise<Result<ExistsOutput, FileSystemError>> => notImplemented(),
    getMetadata: async (_input: GetMetadataInput): Promise<Result<GetMetadataOutput, FileSystemError>> => notImplemented(),
    setMetadata: async (_input: SetMetadataInput): Promise<Result<SetMetadataOutput, FileSystemError>> => notImplemented(),
    createPresignedUploadUrl: async (_input: PresignedUploadInput): Promise<Result<PresignedUploadOutput, FileSystemError>> => notImplemented(),
    createPresignedDownloadUrl: async (_input: PresignedDownloadInput): Promise<Result<PresignedDownloadOutput, FileSystemError>> => notImplemented(),
    getPublicUrl: async (_input: GetPublicUrlInput): Promise<Result<GetPublicUrlOutput, FileSystemError>> => notImplemented(),
  };
};

/**
 * Build a `FileSystem` from a `FileSystemConfig`. Throws
 * `FileSystemError` (with `cause` carrying the Zod issues) if the
 * config is malformed.
 *
 * The throw (vs return) is deliberate: the env-singleton catches it
 * and fails the process; server-action callers can wrap in their
 * own try/catch where it matters.
 */
export const createFileSystem = (config: FileSystemConfig): FileSystem => {
  // Defensive parse: the type system already says config is
  // FileSystemConfig, but if a caller slips through a bad object
  // (e.g. from a JSON.parse of an env file) we want the failure to
  // surface as a typed FileSystemError, not a raw ZodError.
  const parsed = parseFileSystemConfig(config);
  if (!parsed.ok) {
    throw parsed.error;
  }

  const adapter = createStubAdapter();

  // PR 2a: forTenant is a structural no-op. PR 3 replaces it with
  // a real per-tenant namespace (prefix rewriting + metadata
  // scoping). We close over `adapter` and the parsed config so the
  // returned child FileSystem is fully self-contained.
  const forTenant = (_tenantId: string): FileSystem => ({
    adapter,
    config: parsed.value,
    metadata: undefined,
    forTenant,
  });

  return {
    adapter,
    config: parsed.value,
    metadata: undefined,
    forTenant,
  };
};
