/**
 * `file-next doctor` — diagnose the local environment for file-next.
 *
 * Checks (each pass/fail):
 *   - Required env vars present (FILE_NEXT_BUCKET, FILE_NEXT_REGION,
 *     FILE_NEXT_PROVIDER, and adapter-specific creds).
 *   - Metadata DB reachable (postgres / sqlite path resolves).
 *   - S3 bucket reachable (HEAD on the configured bucket returns 200
 *     or 403 — not network error).
 *
 * Usage:
 *   file-next doctor
 *
 * Exit codes:
 *   0 — all checks pass
 *   1 — one or more checks failed (printed to stderr)
 *   2 — invalid configuration (e.g. unknown provider)
 */

export interface DoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface DoctorOptions {
  /** Env vars to validate. The CLI uses process.env by default. */
  readonly env?: NodeJS.ProcessEnv;
  /** Optional callback to test DB reachability. */
  readonly probeDb?: (provider: "postgres" | "sqlite") => Promise<{ ok: boolean; detail: string }>;
  /** Optional callback to test S3 bucket reachability. */
  readonly probeBucket?: (bucket: string, region: string) => Promise<{ ok: boolean; detail: string }>;
}

const REQUIRED_VARS = ["FILE_NEXT_BUCKET", "FILE_NEXT_REGION", "FILE_NEXT_PROVIDER"] as const;
const POSTGRES_VARS = ["FILE_NEXT_PG_HOST", "FILE_NEXT_PG_USER", "FILE_NEXT_PG_DATABASE"] as const;
const SQLITE_VAR = "FILE_NEXT_SQLITE_PATH";

/**
 * Run all checks. Returns a list of { name, ok, detail } records.
 * The CLI formats and prints them; the caller decides the exit code.
 */
export async function runDoctor(options: DoctorOptions = {}): Promise<{
  checks: ReadonlyArray<DoctorCheck>;
  allOk: boolean;
}> {
  const env = options.env ?? process.env;
  const checks: DoctorCheck[] = [];

  // 1. Provider declared
  const provider = env.FILE_NEXT_PROVIDER;
  if (!provider) {
    checks.push({
      name: "provider declared",
      ok: false,
      detail: "FILE_NEXT_PROVIDER is not set (expected 's3' or 'r2')",
    });
  } else if (provider !== "s3" && provider !== "r2") {
    checks.push({
      name: "provider valid",
      ok: false,
      detail: `FILE_NEXT_PROVIDER="${provider}" is not recognized (expected 's3' or 'r2')`,
    });
  } else {
    checks.push({
      name: "provider valid",
      ok: true,
      detail: `FILE_NEXT_PROVIDER="${provider}"`,
    });
  }

  // 2. Required env vars present
  for (const v of REQUIRED_VARS) {
    checks.push({
      name: `env ${v}`,
      ok: typeof env[v] === "string" && env[v]!.length > 0,
      detail: env[v] ? `${v}="${env[v]}"` : `${v} is missing`,
    });
  }

  // 3. Adapter-specific vars
  const adapter = provider === "r2" ? "postgres" : (env.FILE_NEXT_ADAPTER ?? "memory");
  if (adapter === "postgres") {
    for (const v of POSTGRES_VARS) {
      checks.push({
        name: `env ${v}`,
        ok: typeof env[v] === "string" && env[v]!.length > 0,
        detail: env[v] ? `${v}="${env[v]}"` : `${v} is missing (required for postgres adapter)`,
      });
    }
  } else if (adapter === "sqlite") {
    checks.push({
      name: `env ${SQLITE_VAR}`,
      ok: typeof env[SQLITE_VAR] === "string" && env[SQLITE_VAR]!.length > 0,
      detail: env[SQLITE_VAR] ?? `${SQLITE_VAR} is missing (required for sqlite adapter)`,
    });
  }

  // 4. DB reachability (only if probe provided)
  if (options.probeDb && (adapter === "postgres" || adapter === "sqlite")) {
    const result = await options.probeDb(adapter);
    checks.push({
      name: `${adapter} reachable`,
      ok: result.ok,
      detail: result.detail,
    });
  }

  // 5. S3 reachability (only if probe provided)
  if (options.probeBucket && env.FILE_NEXT_BUCKET && env.FILE_NEXT_REGION) {
    const result = await options.probeBucket(env.FILE_NEXT_BUCKET, env.FILE_NEXT_REGION);
    checks.push({
      name: "bucket reachable",
      ok: result.ok,
      detail: result.detail,
    });
  }

  const allOk = checks.every((c) => c.ok);
  return { checks, allOk };
}

/**
 * Pretty-print the doctor report to stdout. Used by the CLI dispatcher.
 */
export function formatDoctorReport(checks: ReadonlyArray<DoctorCheck>): string {
  const lines = checks.map((c) => {
    const mark = c.ok ? "✓" : "✗";
    return `  ${mark} ${c.name.padEnd(28)} ${c.detail}`;
  });
  const passed = checks.filter((c) => c.ok).length;
  const total = checks.length;
  return [`file-next doctor: ${passed}/${total} checks passed`, ...lines].join("\n") + "\n";
}
