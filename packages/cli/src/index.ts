/**
 * `file-next` CLI library — exports `dispatch()` and command parsers
 * for programmatic use AND for the bin shim.
 *
 * The actual binary entry point is `./bin.mjs` (in this directory;
 * tsup writes it to `dist/bin.mjs`). It imports `dispatch` from
 * here and handles the process.exit / stdout / stderr wiring.
 *
 * Why split it this way:
 *   - Tests can import from `@/index` (this file) without triggering
 *     any process.exit side effects.
 *   - The bin file is tiny (3 lines) and exists solely to translate
 *     `dispatch()`'s return value into the correct process exit +
 *     stdout/stderr writes.
 *   - No brittle `import.meta.url === process.argv[1]` heuristics
 *     (those break on macOS symlinks like /tmp → /private/tmp).
 */
import { parseMigrateArgs, runMigrate, type MigrateHooks } from "./migrate.js";
import { parseReconcileArgs, runReconcile, type ReconcileHooks } from "./reconcile.js";
import { runDoctor, formatDoctorReport } from "./doctor.js";

export const VERSION = "0.1.0";

export function printHelp(version: string = VERSION): string {
  return `file-next CLI v${version}

Usage:
  file-next <command> [options]

Commands:
  migrate    Apply pending metadata schema migrations
             --adapter=<postgres|sqlite>  (required)
  reconcile  Detect and (optionally) fix S3 vs metadata drift
             --tenant=<id>                (required)
             --dry-run                    (default: false)
  doctor     Diagnose the local environment
             (checks env vars + adapter reachability)

Flags:
  --version  Print the CLI version
  --help     Print this help

Exit codes:
  0   success
  1   expected failure (drift detected, doctor found an issue)
  2   configuration / runtime error
`;
}

export interface DispatchHooks {
  readonly migrate?: MigrateHooks;
  readonly reconcile?: ReconcileHooks;
}

/**
 * Dispatch a CLI invocation to the right command and return the exit code.
 *
 * Does NOT call `process.exit` — that is the caller's job (the bin
 * script at the bottom of this file). Pure dispatch logic so it
 * can be unit-tested without spawning a subprocess.
 */
export async function dispatch(
  argv: ReadonlyArray<string>,
  hooks: DispatchHooks = {},
  version: string = VERSION,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const out = { stdout: "", stderr: "" };
  const writeOut = (s: string) => (out.stdout += s);
  const writeErr = (s: string) => (out.stderr += s);
  const command = argv[0];

  switch (command) {
    case "--version":
    case "-v":
      writeOut(`file-next ${version}\n`);
      return { exitCode: 0, ...out };

    case "--help":
    case "-h":
      writeOut(printHelp(version));
      return { exitCode: 0, ...out };

    case undefined:
      writeOut(printHelp(version));
      return { exitCode: 1, ...out };

    case "migrate": {
      const parsed = parseMigrateArgs(argv.slice(1));
      if ("error" in parsed) {
        writeErr(`file-next migrate: ${parsed.error}\n`);
        return { exitCode: 2, ...out };
      }
      try {
        const result = await runMigrate(parsed, hooks.migrate);
        writeOut(
          `Applied ${result.applied.length} migration(s); ${result.pending.length} pending.\n`,
        );
        return { exitCode: 0, ...out };
      } catch (err) {
        writeErr(`file-next migrate: ${(err as Error).message}\n`);
        return { exitCode: 2, ...out };
      }
    }

    case "reconcile": {
      const parsed = parseReconcileArgs(argv.slice(1));
      if ("error" in parsed) {
        writeErr(`file-next reconcile: ${parsed.error}\n`);
        return { exitCode: 2, ...out };
      }
      try {
        const result = await runReconcile(parsed, hooks.reconcile);
        writeOut(
          `tenant=${parsed.tenant} drift: missingInS3=${result.drift.missingInS3.length} ` +
            `orphansInS3=${result.drift.orphansInS3.length} ` +
            `fixed=${result.drift.fixedCount} ` +
            `${parsed.dryRun ? "(dry-run)" : ""}\n`,
        );
        return { exitCode: result.hadDrift ? 1 : 0, ...out };
      } catch (err) {
        writeErr(`file-next reconcile: ${(err as Error).message}\n`);
        return { exitCode: 2, ...out };
      }
    }

    case "doctor": {
      try {
        const { checks, allOk } = await runDoctor();
        writeOut(formatDoctorReport(checks));
        return { exitCode: allOk ? 0 : 1, ...out };
      } catch (err) {
        writeErr(`file-next doctor: ${(err as Error).message}\n`);
        return { exitCode: 2, ...out };
      }
    }

    default:
      writeErr(`Unknown command: ${command}\nRun 'file-next --help'.\n`);
      return { exitCode: 2, ...out };
  }
}

// No top-level process.exit / dispatch here. The bin shim
// (`bin.mjs` in this directory; emitted to `dist/bin.mjs` by tsup)
// is the only entry point that calls `dispatch()` and writes
// its stdout/stderr to the actual process streams.
