import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import yaml from "yaml";

const ROOT = path.resolve(__dirname, "..");
const workspacePath = path.join(ROOT, "pnpm-workspace.yaml");
const packageJsonPath = path.join(ROOT, "package.json");

describe("T-001: pnpm-workspace.yaml + root scripts", () => {
  describe("pnpm-workspace.yaml", () => {
    it("exists at the repository root", () => {
      expect(existsSync(workspacePath)).toBe(true);
    });

    it("declares the packages/* glob", () => {
      const raw = readFileSync(workspacePath, "utf8");
      const parsed = yaml.parse(raw) as { packages?: unknown };
      expect(parsed).toBeTypeOf("object");
      expect(parsed.packages).toEqual(["packages/*"]);
    });
  });

  describe("root package.json scripts", () => {
    let pkg: { scripts?: Record<string, string> };

    beforeAll(() => {
      pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
    });

    it.each([
      ["build"],
      ["test"],
      ["test:run"],
      ["typecheck"],
      ["changeset"],
    ])("declares the %s script", (scriptName) => {
      expect(pkg.scripts?.[scriptName], `missing script: ${scriptName}`).toBeTypeOf(
        "string",
      );
    });
  });

  describe("pnpm workspace resolves", () => {
    it("`pnpm -r ls --depth=-1` exits 0 (workspace YAML is parseable)", () => {
      // This proves pnpm can parse the workspace file. We don't assert specific
      // packages here because packages/ doesn't exist yet (T-002 creates it).
      expect(() => {
        execSync("pnpm -r ls --depth=-1", {
          cwd: ROOT,
          stdio: "pipe",
        });
      }).not.toThrow();
    });
  });
});
