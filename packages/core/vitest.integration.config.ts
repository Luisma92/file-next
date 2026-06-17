import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config for the integration suite (`pnpm test:integration`).
 *
 * Separate from the main core config so the unit suite stays fast
 * and offline. The integration suite requires a real S3-compatible
 * endpoint (MinIO by default) and is opt-in via env vars.
 */
export default defineConfig({
  test: {
    name: "core-integration",
    environment: "node",
    root: __dirname,
    include: ["tests/integration/**/*.{test,spec}.{ts,tsx}"],
    // Integration tests are slow (network round-trips). Give
    // each test a generous timeout; the per-test describe.skipIf
    // in the file is the actual gate.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
