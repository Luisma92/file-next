/**
 * Vitest workspace project for the shadcn registry items.
 *
 * Uses jsdom + React plugin (matches the headless project) so we can
 * render and test the .tsx components. Components import from
 * `@file-next/headless` (the published package name); the alias
 * below points that to the source so tests don't require a prior
 * build of the headless package.
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    name: "registry",
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "@file-next/headless": path.resolve(__dirname, "../packages/headless/src/index.ts"),
      // `file-next` is the core package's published name. Tests
      // resolve it to a tiny stub (registry/tests/stubs/file-next.ts)
      // so we don't pull in core's source files (which use internal
      // `@/*` aliases that conflict with the registry's own paths).
      "file-next": path.resolve(__dirname, "./tests/stubs/file-next.ts"),
    },
  },
});
