import { defineConfig } from "tsup";
import path from "node:path";

/**
 * tsup build for the `@file-next/cli` package.
 *
 * Single entry that becomes the `file-next` binary.
 * The CLI uses Node's built-in `node:util.parseArgs` — no external
 * dependencies for argument parsing. Drizzle / pg / etc. are NOT
 * bundled; the CLI imports from `file-next` (the core package) which
 * in turn loads the relevant adapter.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node20",
  splitting: false,
  treeshake: true,
  // Mark the entry as a CLI binary so the shebang is preserved.
  banner: {
    js: "#!/usr/bin/env node",
  },
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
  esbuildOptions(options) {
    options.alias = {
      ...(options.alias ?? {}),
      "@": path.resolve(__dirname, "./src"),
    };
  },
});
