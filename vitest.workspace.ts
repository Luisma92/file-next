import { defineWorkspace } from "vitest/config";

/**
 * Vitest workspace: root meta tests (pnpm workspace, repo tsconfig)
 * and per-package projects (packages/core).
 *
 * The root meta project runs in node env (no DOM needed for shell
 * and config assertions). The packages/core project runs in jsdom
 * so React + jest-dom matchers are available for the library.
 */
export default defineWorkspace([
  {
    test: {
      name: "meta",
      include: ["tests/**/*.{test,spec}.{ts,tsx}"],
      environment: "node",
    },
  },
  "./packages/core/vitest.config.ts",
  "./packages/headless/vitest.config.ts",
]);
