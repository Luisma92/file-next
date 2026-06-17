import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    name: "cli",
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `file-next` is the core package's published name. We point it
      // at the source so tests can mock its exports without a prior
      // build step.
      "file-next": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
});
