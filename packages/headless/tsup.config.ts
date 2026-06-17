/**
 * tsup build for the `@file-next/headless` package.
 *
 * One entry: `src/index.ts` (the 5 React hooks, re-exported).
 * ESM + CJS + dts, `@/*` alias, `react` and `react-dom` externalized
 * (they are peer-deps — the consumer provides them at runtime; bundling
 * them in would defeat that). `clean: true` wipes `dist/` on every build.
 *
 * Mirrors the core package's tsup config (ESM+CJS+DTS, clean, target
 * es2022, single entry) so the build contract is consistent across
 * the monorepo.
 */
import { defineConfig } from "tsup";
import path from "node:path";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  splitting: false,
  treeshake: true,
  external: ["react", "react-dom", "react/jsx-runtime"],
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
