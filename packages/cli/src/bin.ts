#!/usr/bin/env node
/**
 * Bin shim for `@file-next/cli`.
 *
 * This file is the only place that translates the pure `dispatch()`
 * return value into process streams + exit. Splitting it out keeps
 * `src/index.ts` side-effect-free (importable by tests without
 * triggering any process.exit).
 *
 * tsup writes this file to `dist/bin.mjs`; the `bin` field in
 * package.json points the `file-next` command at it.
 */
import { dispatch } from "./index.js";

dispatch(process.argv.slice(2))
  .then(({ exitCode, stdout, stderr }) => {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    process.exit(exitCode);
  })
  .catch((err: unknown) => {
    process.stderr.write(`Unexpected error: ${(err as Error).message}\n`);
    process.exit(2);
  });
