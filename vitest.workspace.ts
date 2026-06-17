import { defineWorkspace } from "vitest/config";

/**
 * Vitest workspace: root meta tests (pnpm workspace, repo tsconfig),
 * per-package projects (packages/core, packages/headless, packages/cli),
 * and the shadcn registry items (registry/).
 *
 * - meta: node env (shell + config assertions)
 * - core: jsdom + React (the storage / metadata / server library)
 * - headless: jsdom + React (the headless hooks)
 * - cli: node (the @file-next/cli binary)
 * - registry: jsdom + React (the shadcn components + their tests)
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
  "./packages/cli/vitest.config.ts",
  "./registry/vitest.config.ts",
]);
