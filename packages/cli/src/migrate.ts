/**
 * `file-next migrate` — apply pending metadata schema migrations.
 *
 * v0.1 scope: prints the migration plan and reports what would run.
 * Actual migration execution is delegated to the adapter package's
 * migrator (Drizzle for postgres/sqlite). This CLI is the orchestrator
 * that resolves the adapter from the config and invokes it.
 *
 * Usage:
 *   file-next migrate --adapter=postgres
 *   file-next migrate --adapter=sqlite
 *
 * Exit codes:
 *   0 — migrations applied (or none pending)
 *   1 — configuration error (missing / unknown adapter)
 *   2 — migration failed (the adapter threw)
 */
import { parseArgs } from "node:util";

export interface MigrateOptions {
  readonly adapter: "postgres" | "sqlite";
}

export function parseMigrateArgs(argv: ReadonlyArray<string>): MigrateOptions | { error: string } {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv as string[],
      options: {
        adapter: { type: "string", short: "a" },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (err) {
    return { error: (err as Error).message };
  }

  const adapter = parsed.values.adapter;
  if (adapter !== "postgres" && adapter !== "sqlite") {
    return { error: "--adapter must be either 'postgres' or 'sqlite'" };
  }
  return { adapter };
}

export interface MigrateResult {
  readonly applied: ReadonlyArray<string>;
  readonly pending: ReadonlyArray<string>;
}

/**
 * Resolve and run migrations against the chosen adapter.
 *
 * v0.1 implementation: returns a static plan rather than touching
 * a real database. The hook for `runAdapterMigrations` is the
 * integration point for v0.2 (which will load Drizzle's migrator
 * dynamically based on the adapter choice).
 */
export interface MigrateHooks {
  /** Resolves the migrator implementation. May throw on unsupported adapter. */
  resolveMigrator: (adapter: MigrateOptions["adapter"]) => Promise<{
    listPending: () => Promise<ReadonlyArray<string>>;
    apply: () => Promise<ReadonlyArray<string>>;
  }>;
}

export async function runMigrate(
  options: MigrateOptions,
  hooks: MigrateHooks = {
    // Default no-op migrator so the CLI can be smoke-tested without
    // a real DB. The real adapter wiring lives in the consumer's
    // app where drizzle-orm is a runtime dep.
    resolveMigrator: async () => ({
      listPending: async () => [],
      apply: async () => [],
    }),
  },
): Promise<MigrateResult> {
  const migrator = await hooks.resolveMigrator(options.adapter);
  const pending = await migrator.listPending();
  const applied = await migrator.apply();
  return { applied, pending };
}
