/**
 * `FileSystemConfig` — the discriminated union of provider configs
 * and its Zod-driven parser.
 *
 * The Zod schema is the single source of truth for both the
 * runtime shape AND the TypeScript type (`z.infer<...>`). Adding a
 * new field is a one-line change in the schema; the inferred type
 * updates automatically and every consumer gets the new field
 * without a separate type definition to keep in sync.
 *
 * Provider-specific shape notes:
 *   - **S3**: `region` is required (AWS regional endpoints). An
 *     optional `endpoint` is allowed for S3-compatible providers
 *     (MinIO, LocalStack, etc.).
 *   - **R2**: `endpoint` is required (Cloudflare R2 has no region
 *     model — you talk to your account's endpoint). `forcePathStyle`
 *     is ALWAYS `true` (R2 requires path-style addressing; the
 *     literal type catches accidental overrides at parse time).
 *
 * `parseFileSystemConfig` is the trust boundary. Callers receive a
 * `Result<FileSystemConfig, FileSystemError>` — a parse failure is
 * an `InternalError` (retryable: false) with the original Zod
 * issues preserved on `cause` for debugging.
 */
import { z } from "zod";
import { ok, err, type Result } from "@/types/result";
import { FileSystemError } from "@/errors";

// ---------------------------------------------------------------------------
// Shared credentials schema
// ---------------------------------------------------------------------------

const CredentialsSchema = z.object({
  accessKeyId: z.string().min(1, "accessKeyId is required"),
  secretAccessKey: z.string().min(1, "secretAccessKey is required"),
});

export type Credentials = z.infer<typeof CredentialsSchema>;

// ---------------------------------------------------------------------------
// Per-provider schemas
// ---------------------------------------------------------------------------

export const S3ConfigSchema = z.object({
  provider: z.literal("s3"),
  bucket: z.string().min(1, "bucket is required"),
  region: z.string().min(1, "region is required"),
  /** Optional S3-compatible endpoint (MinIO, LocalStack, ...). */
  endpoint: z.string().url().optional(),
  credentials: CredentialsSchema,
  /** Default false; some S3-compatible providers need path-style. */
  forcePathStyle: z.boolean().default(false),
});

export const R2ConfigSchema = z.object({
  provider: z.literal("r2"),
  bucket: z.string().min(1, "bucket is required"),
  endpoint: z.string().url("R2 requires an endpoint URL"),
  credentials: CredentialsSchema,
  /** R2 ONLY supports path-style; the literal-true type makes that explicit. */
  forcePathStyle: z.literal(true),
});

export const FileSystemConfigSchema = z.discriminatedUnion("provider", [
  S3ConfigSchema,
  R2ConfigSchema,
]);

export type S3Config = z.infer<typeof S3ConfigSchema>;
export type R2Config = z.infer<typeof R2ConfigSchema>;
export type FileSystemConfig = z.infer<typeof FileSystemConfigSchema>;

// ---------------------------------------------------------------------------
// Parser — the single trust boundary for env-derived config
// ---------------------------------------------------------------------------

/**
 * Parse an unknown value (typically the env object) into a typed
 * `FileSystemConfig`. Returns a `Result` so the call site can
 * branch on parse failure without try/catch.
 *
 * Mapping strategy:
 *   - On success: `ok(config)`.
 *   - On Zod failure: `err(FileSystemError(InternalError, retryable: false))`
 *     with the original issues preserved on `cause` (as a synthetic
 *     `{ code: "ZodError", message, issues }` shape so the
 *     FileSystemError contract is honored).
 */
export const parseFileSystemConfig = (
  input: unknown,
): Result<FileSystemConfig, FileSystemError> => {
  const parsed = FileSystemConfigSchema.safeParse(input);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(
    new FileSystemError({
      code: "InternalError",
      message: "Invalid FileSystemConfig",
      retryable: false,
      cause: {
        code: "ZodError",
        message: parsed.error.message,
        issues: parsed.error.issues,
      },
    }),
  );
};
