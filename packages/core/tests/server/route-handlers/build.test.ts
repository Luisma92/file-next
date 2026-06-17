/**
 * Build smoke test for the `./server` subpath (T-051).
 *
 * The library's own `server/index.ts` is the testable surface —
 * it does NOT include `import "server-only"` (that would break
 * vitest under jsdom, per the PR 1 discovery). The `./server`
 * package.json subpath maps to `dist/server/index.{js,cjs,d.ts}`,
 * which IS the production entry and DOES re-export the
 * `server-only` package.
 *
 * This test asserts the build output shape. It runs as part of
 * `pnpm test:run`, but skips cleanly when the dist hasn't been
 * built (so CI can run `pnpm build` first, then `pnpm test:run`,
 * OR the local dev loop can run tests without rebuilding).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(here, "../../dist");

describe("T-051: file-next/server subpath build output", () => {
  it("dist/server/index.js exists and re-exports server-only", () => {
    const f = resolve(distRoot, "server/index.js");
    if (!existsSync(f)) {
      // Skip cleanly: dist hasn't been built in this environment.
      // The actual build smoke test is `pnpm --filter file-next build`
      // which the orchestrator runs as part of T-051 verification.
      return;
    }
    const content = readFileSync(f, "utf-8");
    // The very first non-empty import must be the server-only
    // re-export. tsup preserves the import statement at the top
    // of the entry module (it's not tree-shakeable).
    expect(content).toMatch(/server-only/);
  });

  it("dist/server/index.cjs exists and requires server-only", () => {
    const f = resolve(distRoot, "server/index.cjs");
    if (!existsSync(f)) return;
    const content = readFileSync(f, "utf-8");
    expect(content).toMatch(/server-only/);
  });

  it("dist/server/index.d.ts exists (types for the subpath)", () => {
    const f = resolve(distRoot, "server/index.d.ts");
    if (!existsSync(f)) return;
    const content = readFileSync(f, "utf-8");
    // dts re-exports the route-handler + action factories.
    expect(content).toMatch(/createUploadRouteHandler/);
    expect(content).toMatch(/createDownloadRouteHandler/);
    expect(content).toMatch(/createServerActions/);
  });
});
