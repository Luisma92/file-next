import { defineWorkspace } from "vitest/config";
import { resolve } from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Vitest workspace: root meta tests (pnpm workspace, repo tsconfig),
 * per-package projects (packages/core, packages/headless, packages/cli),
 * and the shadcn registry items (registry/).
 *
 * - meta: node env (shell + config assertions). Uses
 *   `vite-tsconfig-paths` to honor the root tsconfig's `paths`
 *   (file-next → packages/core/src, file-next/server → server, etc.).
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
    plugins: [
      tsconfigPaths({
        projects: [resolve(__dirname, "./tsconfig.json")],
      }),
    ],
  },
  "./packages/core/vitest.config.ts",
  "./packages/headless/vitest.config.ts",
  "./packages/cli/vitest.config.ts",
  "./registry/vitest.config.ts",
]);
