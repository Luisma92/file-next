import { defineWorkspace } from "vitest/config";
import path from "node:path";

/**
 * Vitest workspace: root meta tests (pnpm workspace, repo tsconfig)
 * and per-package projects (packages/core).
 *
 * The root meta project runs in node env (no DOM needed for shell
 * and config assertions). The packages/core project runs in jsdom
 * so React + jest-dom matchers are available for the library.
 *
 * The meta project keeps a temporary @/lib alias that resolves to
 * the current src/lib location so the legacy cn test keeps passing
 * before T-004 migrates the test into packages/core.
 */
export default defineWorkspace([
  {
    test: {
      name: "meta",
      include: ["tests/**/*.{test,spec}.{ts,tsx}"],
      environment: "node",
    },
    resolve: {
      alias: {
        "@/lib": path.resolve(__dirname, "./src/lib"),
      },
    },
  },
  "./packages/core/vitest.config.ts",
]);
