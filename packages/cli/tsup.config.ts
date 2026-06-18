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
    bin: "src/bin.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node20",
  splitting: false,
  treeshake: true,
  // No `banner` here — the shebang in src/bin.ts is preserved by
  // tsup for the `bin` entry. The `index` entry stays side-effect-free.
  // (tsup preserves a leading `#!/usr/bin/env node` from source.)
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
