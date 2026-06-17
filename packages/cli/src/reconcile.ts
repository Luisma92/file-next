/**
 * `file-next reconcile` — find and (optionally) fix drift between
 * the S3 bucket and the metadata index.
 *
 * Usage:
 *   file-next reconcile --tenant=acme
 *   file-next reconcile --tenant=acme --dry-run
 *
 * Exit codes:
 *   0 — no drift detected (or all drift fixed)
 *   1 — drift detected AND not fixed (dry-run mode)
 *   2 — configuration / connectivity error
 */
import { parseArgs } from "node:util";

export interface ReconcileOptions {
  readonly tenant: string;
  readonly dryRun: boolean;
}

export function parseReconcileArgs(
  argv: ReadonlyArray<string>,
): ReconcileOptions | { error: string } {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv as string[],
      options: {
        tenant: { type: "string", short: "t" },
        "dry-run": { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (err) {
    return { error: (err as Error).message };
  }

  if (typeof parsed.values.tenant !== "string" || parsed.values.tenant.length === 0) {
    return { error: "--tenant is required" };
  }
  return {
    tenant: parsed.values.tenant,
    dryRun: parsed.values["dry-run"] === true,
  };
}

export interface DriftReport {
  readonly missingInS3: ReadonlyArray<string>;
  readonly orphansInS3: ReadonlyArray<string>;
  readonly fixedCount: number;
}

export interface ReconcileResult {
  readonly drift: DriftReport;
  readonly hadDrift: boolean;
}

/**
 * Run a reconcile cycle for a tenant.
 *
 * v0.1: the actual sync logic is provided via the `runSync` hook so
 * this CLI is testable without a real Postgres / S3 backend. The
 * consumer wires the real `reconcile()` from `file-next/sync` into
 * the hook when running the CLI against production.
 */
export interface ReconcileHooks {
  runSync: (input: {
    tenant: string;
    dryRun: boolean;
  }) => Promise<DriftReport>;
}

export async function runReconcile(
  options: ReconcileOptions,
  hooks: ReconcileHooks = {
    runSync: async () => ({
      missingInS3: [],
      orphansInS3: [],
      fixedCount: 0,
    }),
  },
): Promise<ReconcileResult> {
  const drift = await hooks.runSync({
    tenant: options.tenant,
    dryRun: options.dryRun,
  });
  const hadDrift = drift.missingInS3.length + drift.orphansInS3.length > 0;
  return { drift, hadDrift };
}
