import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(__dirname, "../..");
const basePath = path.join(ROOT, "tsconfig.base.json");
const coreTsconfigPath = path.join(ROOT, "packages/core/tsconfig.json");

describe("T-002: tsconfig.base.json + packages/core/tsconfig.json", () => {
  describe("tsconfig.base.json", () => {
    let cfg: { compilerOptions: Record<string, unknown>; include?: unknown[] };

    beforeAll(() => {
      cfg = JSON.parse(readFileSync(basePath, "utf8")) as typeof cfg;
    });

    it("exists at the repository root", () => {
      expect(existsSync(basePath)).toBe(true);
    });

    it("enables TypeScript strict mode", () => {
      expect(cfg.compilerOptions.strict).toBe(true);
    });

    it("targets ES2022", () => {
      expect(cfg.compilerOptions.target).toBe("ES2022");
    });

    it("uses bundler module resolution", () => {
      expect(cfg.compilerOptions.moduleResolution).toBe("bundler");
    });

    it("emits declarations and declaration maps for library consumers", () => {
      expect(cfg.compilerOptions.declaration).toBe(true);
      expect(cfg.compilerOptions.declarationMap).toBe(true);
    });

    it("does not emit JS (libraries are bundled separately by tsup)", () => {
      expect(cfg.compilerOptions.noEmit).toBe(true);
    });

    it("treats the file as a config skeleton (does not include source files itself)", () => {
      expect(cfg.include ?? []).toEqual([]);
    });
  });

  describe("packages/core/tsconfig.json", () => {
    it("exists", () => {
      expect(existsSync(coreTsconfigPath)).toBe(true);
    });

    it("extends the root base config", () => {
      const cfg = JSON.parse(readFileSync(coreTsconfigPath, "utf8")) as {
        extends?: string;
      };
      expect(cfg.extends).toBe("../../tsconfig.base.json");
    });

    it("compiles a deliberately-strict hello-world sample without errors", () => {
      // Arrange: write a strict TS file into a scratch directory and point
      // tsc at it using an absolute extends path to the base config.
      const tmp = mkdtempSync(path.join(os.tmpdir(), "fn-tsc-"));
      const src = path.join(tmp, "hello.ts");
      writeFileSync(
        src,
        [
          "// Forces noUncheckedIndexedAccess + exactOptionalPropertyTypes to bite.",
          "export function greet(name: string | undefined): string {",
          "  if (name === undefined) return 'hello, world';",
          "  return `hello, ${name}`;",
          "}",
          "",
          "export const values: readonly number[] = [1, 2, 3];",
          "export const first: number = values[0]!;",
          "",
        ].join("\n"),
        "utf8",
      );

      const tsconfig = path.join(tmp, "tsconfig.json");
      writeFileSync(
        tsconfig,
        JSON.stringify({
          extends: basePath,
          compilerOptions: { noEmit: true },
          include: ["hello.ts"],
        }),
        "utf8",
      );

      // Act + Assert
      let stderr = "";
      try {
        execSync(`npx tsc --noEmit -p ${tsconfig}`, {
          cwd: ROOT,
          stdio: "pipe",
        });
      } catch (err) {
        stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err);
      }
      // Filter unrelated npm/npx noise (warnings about .npmrc env vars) so
      // the assertion isolates tsc behavior.
      const tscErrors = stderr
        .split("\n")
        .filter((line) => !/^npm warn/i.test(line))
        .join("\n")
        .trim();
      expect(tscErrors, tscErrors || "(no tsc errors)").toBe("");
    });
  });
});
