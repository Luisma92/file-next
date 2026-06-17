/**
 * tsup build for the `file-next` core package.
 *
 * Two entries, two output paths:
 *   - `src/index.ts`           → `dist/index.{js,cjs,d.ts}` (the main
 *     `file-next` package — re-exports everything, no server-only)
 *   - `src/server/entry.ts`    → `dist/server/index.{js,cjs,d.ts}`
 *     (the `file-next/server` subpath — has `import "server-only"`
 *     at the top; a careless client-component import fails the
 *     Next.js build per spec scenario `distribution#1`)
 *
 * Both entries share the dual ESM + CJS + dts format, the `@/*`
 * alias, the `clean: true` flag, and the same `target: "es2022"`.
 *
 * The `server-only` package is a real npm dependency, so tsup
 * externalizes it (the import statement stays in the bundle as
 * `import "server-only"` / `require("server-only")` — exactly
 * what we want for the server subpath).
 */
import { defineConfig } from "tsup";
import path from "node:path";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "server/index": "src/server/entry.ts",
  },
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
