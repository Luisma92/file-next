import { defineConfig } from "tsup";
import path from "node:path";

/**
 * tsup build for the `file-next` core package.
 *
 * - Single entry (`src/index.ts`); storage adapter, server, and headless
 *   land in later PRs and get their own entries / packages.
 * - Dual format (ESM + CJS) with `.d.ts` so consumers can `require()`
 *   or `import` from any modern bundler.
 * - `@/*` path alias mirrors the vitest config so source code can use
 *   the same imports in tests and in the built bundle.
 * - `clean: true` wipes `dist/` on every build to avoid stale files
 *   when entries are added/removed in later PRs.
 * - `splitting: false` keeps the ESM output as a single file (no
 *   shared chunks) which is the safer default for libraries.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  splitting: false,
  treeshake: true,
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
