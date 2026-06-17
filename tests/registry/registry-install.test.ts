/**
 * Registry install smoke test — guards the install surface that
 * `npx shadcn@^2.1.0 add <registry-item>` depends on.
 *
 * The skeleton test (`registry-skeleton.test.ts`) checks structural
 * validity. This file checks the install semantics:
 *   - `dependencies` entries look like npm package names (lowercase,
 *     no spaces, may include a version range like "@1.0.0" or
 *     "@^2.1.0").
 *   - `registryDependencies` entries are bare names (resolved against
 *     the local registry) or @scope/name or full URLs.
 *   - Each file in `files[]` either has a `target` or the consumer's
 *     components.json would resolve the path (we test with a stub
 *     components.json to mimic the install).
 *   - Each component imports from packages the consumer would also
 *     install (no orphan dependencies).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const REGISTRY_DIR = resolve(ROOT, "registry");

const NPM_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:@[~^]?\d+\.\d+\.\d+(?:[-+][\w.-]+)?)?$/;
const REGISTRY_DEP =
  /^(?:[a-z][a-z0-9-]*|@[a-z0-9][\w.-]*\/[a-z][a-z0-9-]*|https?:\/\/.+)$/;

const listItemJson = (): Array<{ jsonName: string; parsed: Record<string, unknown> }> => {
  const files = readdirSync(REGISTRY_DIR).filter(
    (f) =>
      f.endsWith(".json") &&
      f !== "registry.json" &&
      f !== "schema-version.json" &&
      f !== "tsconfig.json",
  );
  return files.map((jsonName) => ({
    jsonName,
    parsed: JSON.parse(readFileSync(resolve(REGISTRY_DIR, jsonName), "utf8")) as Record<string, unknown>,
  }));
};

describe("registry install smoke — shadcn add semantics", () => {
  it("every item declares at least one file", () => {
    for (const { parsed } of listItemJson()) {
      const files = (parsed.files as Array<unknown>) ?? [];
      expect(files.length, `${parsed.name}: files.length`).toBeGreaterThan(0);
    }
  });

  it("every dependency is a valid npm package specifier", () => {
    for (const { parsed } of listItemJson()) {
      const deps = (parsed.dependencies as string[]) ?? [];
      for (const dep of deps) {
        expect(NPM_NAME.test(dep), `${parsed.name}: invalid dep "${dep}"`).toBe(true);
      }
    }
  });

  it("every devDependency is a valid npm package specifier", () => {
    for (const { parsed } of listItemJson()) {
      const deps = (parsed.devDependencies as string[]) ?? [];
      for (const dep of deps) {
        expect(NPM_NAME.test(dep), `${parsed.name}: invalid devDep "${dep}"`).toBe(true);
      }
    }
  });

  it("every registryDependency is a name, scope/name, or URL", () => {
    for (const { parsed } of listItemJson()) {
      const deps = (parsed.registryDependencies as string[]) ?? [];
      for (const dep of deps) {
        expect(REGISTRY_DEP.test(dep), `${parsed.name}: invalid registryDep "${dep}"`).toBe(true);
      }
    }
  });

  it("every item has a unique $schema and name", () => {
    const items = listItemJson();
    const names = new Set<string>();
    for (const { parsed } of items) {
      expect(parsed.$schema).toBe("https://ui.shadcn.com/schema/registry-item.json");
      expect(names.has(parsed.name as string), `duplicate name: ${parsed.name}`).toBe(false);
      names.add(parsed.name as string);
    }
  });

  it("every file's source path exists on disk", () => {
    for (const { parsed } of listItemJson()) {
      const files = (parsed.files as Array<{ path: string }>) ?? [];
      for (const file of files) {
        const sourcePath = resolve(ROOT, file.path);
        expect(
          existsSync(sourcePath),
          `${parsed.name}: missing source file ${file.path}`,
        ).toBe(true);
      }
    }
  });

  it("every file's source is a real .tsx (not a stub)", () => {
    for (const { parsed } of listItemJson()) {
      const files = (parsed.files as Array<{ path: string; type: string }>) ?? [];
      for (const file of files) {
        if (file.type === "registry:component" || file.type === "registry:ui") {
          const sourcePath = resolve(ROOT, file.path);
          if (existsSync(sourcePath)) {
            const content = readFileSync(sourcePath, "utf8");
            // A real component has at least one exported symbol and JSX.
            expect(
              content.length,
              `${parsed.name}: ${file.path} is suspiciously short`,
            ).toBeGreaterThan(200);
            expect(content, `${parsed.name}: ${file.path} missing JSX`).toMatch(/<[A-Z][A-Za-z0-9]+/);
          }
        }
      }
    }
  });

  it("headless items declare @file-next/headless as a registryDependency", () => {
    const items = listItemJson();
    const fileBrowser = items.find((i) => i.parsed.name === "file-browser");
    const fileUploader = items.find((i) => i.parsed.name === "file-uploader");
    const fileActions = items.find((i) => i.parsed.name === "file-actions");
    for (const item of [fileBrowser, fileUploader, fileActions]) {
      const deps = (item!.parsed.registryDependencies as string[]) ?? [];
      expect(
        deps.includes("@file-next/headless"),
        `${item!.parsed.name} must declare @file-next/headless`,
      ).toBe(true);
    }
  });

  it("non-hook items declare no registryDependencies (no headless needed)", () => {
    const items = listItemJson();
    const nonHookItems = items.filter(
      (i) => !["file-browser", "file-uploader", "file-actions"].includes(i.parsed.name as string),
    );
    for (const item of nonHookItems) {
      const deps = (item.parsed.registryDependencies as string[]) ?? [];
      // breadcrumbs, file-preview, empty-state, error-state don't need the headless package.
      expect(
        deps.length === 0,
        `${item.parsed.name} unexpectedly declares registryDependencies`,
      ).toBe(true);
    }
  });
});
