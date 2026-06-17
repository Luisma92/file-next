/**
 * Smoke tests for the shadcn registry skeleton.
 *
 * Validates:
 *   - `registry/registry.json` is valid JSON with the expected shape.
 *   - `registry/schema-version.json` pins a known schema version.
 *   - Every item declared in `registry.json` has a corresponding
 *     `registry/<item>.json` file.
 *
 * These tests run in the `meta` workspace project (node env) — no
 * DOM, no React. They guard the install surface for `npx shadcn add`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const REGISTRY_DIR = resolve(ROOT, "registry");

describe("registry skeleton — spec registry installability", () => {
  it("registry/registry.json is valid JSON with the file-next name", () => {
    const raw = readFileSync(resolve(REGISTRY_DIR, "registry.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      name?: string;
      items?: Array<{ name: string; type: string; title: string; description: string }>;
    };
    expect(parsed.name).toBe("file-next");
    expect(Array.isArray(parsed.items)).toBe(true);
    expect(parsed.items!.length).toBeGreaterThanOrEqual(7);
  });

  it("registry/schema-version.json pins a known schema version", () => {
    const raw = readFileSync(resolve(REGISTRY_DIR, "schema-version.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: number; schemaVersion?: string };
    expect(parsed.version).toBe(1);
    expect(parsed.schemaVersion).toBe("v0");
  });

  it("declares the 7 P0 registry items", () => {
    const raw = readFileSync(resolve(REGISTRY_DIR, "registry.json"), "utf8");
    const parsed = JSON.parse(raw) as { items?: Array<{ name: string }> };
    const names = new Set((parsed.items ?? []).map((i) => i.name));
    for (const expected of [
      "file-browser",
      "file-uploader",
      "file-actions",
      "breadcrumbs",
      "file-preview",
      "empty-state",
      "error-state",
    ]) {
      expect(names.has(expected), `expected registry item "${expected}"`).toBe(true);
    }
  });

  it("every declared item has a matching registry/<item>.json file", () => {
    const raw = readFileSync(resolve(REGISTRY_DIR, "registry.json"), "utf8");
    const parsed = JSON.parse(raw) as { items?: Array<{ name: string }> };
    for (const item of parsed.items ?? []) {
      const path = resolve(REGISTRY_DIR, `${item.name}.json`);
      expect(existsSync(path), `missing ${item.name}.json`).toBe(true);
    }
  });

  it("every registry/<item>.json has the required shadcn fields", () => {
    const items = (JSON.parse(readFileSync(resolve(REGISTRY_DIR, "registry.json"), "utf8")) as {
      items?: Array<{ name: string }>;
    }).items ?? [];
    for (const { name } of items) {
      const path = resolve(REGISTRY_DIR, `${name}.json`);
      if (!existsSync(path)) continue;
      const parsed = JSON.parse(readFileSync(path, "utf8")) as {
        $schema?: string;
        name?: string;
        type?: string;
        title?: string;
        description?: string;
        files?: Array<{ path: string; type: string; target?: string }>;
      };
      expect(parsed.$schema, `${name}: $schema`).toBe(
        "https://ui.shadcn.com/schema/registry-item.json",
      );
      expect(parsed.name, `${name}: name`).toBe(name);
      expect(parsed.type, `${name}: type`).toMatch(/^registry:/);
      expect(typeof parsed.title, `${name}: title`).toBe("string");
      expect(typeof parsed.description, `${name}: description`).toBe("string");
      expect(Array.isArray(parsed.files), `${name}: files`).toBe(true);
      expect(parsed.files!.length, `${name}: files.length`).toBeGreaterThan(0);
    }
  });

  it("every registry item file references an existing source file", () => {
    const files = readdirSync(REGISTRY_DIR).filter((f) => f.endsWith(".json"));
    for (const jsonFile of files) {
      if (jsonFile === "registry.json" || jsonFile === "schema-version.json") continue;
      const parsed = JSON.parse(readFileSync(resolve(REGISTRY_DIR, jsonFile), "utf8")) as {
        files?: Array<{ path: string }>;
      };
      for (const file of parsed.files ?? []) {
        const sourcePath = resolve(ROOT, file.path);
        expect(
          existsSync(sourcePath),
          `${jsonFile} references missing file: ${file.path}`,
        ).toBe(true);
      }
    }
  });
});
