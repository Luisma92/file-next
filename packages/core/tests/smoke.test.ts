/**
 * Smoke test for the built `file-next` package.
 *
 * Imports from the package name (`file-next`) — not the relative
 * source path — so this test only passes if:
 *   1. tsup produced a `dist/` output (ESM + CJS + d.ts)
 *   2. The `exports` map in `packages/core/package.json` resolves
 *   3. pnpm workspace symlinked the package into `node_modules`
 *
 * This is the regression guard for T-008; it should run as part of
 * the normal test suite (no separate build step required — vitest
 * resolves the package via the workspace symlink).
 */
import { describe, it, expect } from "vitest";
import {
  ok,
  err,
  map,
  andThen,
  unwrapOr,
  FileSystemError,
  FILE_SYSTEM_ERROR_CODES,
  RETRYABLE_BY_CODE,
  asPath,
  assertS3Key,
  cn,
} from "file-next";

describe("file-next package smoke (T-008)", () => {
  it("re-exports Result helpers that compose end-to-end", () => {
    const r1 = ok(2);
    const r2 = map(r1, (n) => n + 3);
    const r3 = andThen(r2, (n) => (n > 0 ? ok(String(n)) : err(new FileSystemError({ code: "InternalError", message: "nope", retryable: false }))));
    expect(unwrapOr(r3, "fallback")).toBe("5");
  });

  it("re-exports FileSystemError with the 11-code catalog", () => {
    expect(FILE_SYSTEM_ERROR_CODES).toHaveLength(11);
    const e = new FileSystemError({ code: "NotFound", message: "missing", retryable: false });
    expect(e).toBeInstanceOf(FileSystemError);
    expect(e.code).toBe("NotFound");
    expect(e.retryable).toBe(false);
    expect(e.toJSON()).toEqual({
      name: "FileSystemError",
      code: "NotFound",
      message: "missing",
      retryable: false,
    });
  });

  it("RETRYABLE_BY_CODE covers every catalog entry", () => {
    for (const code of FILE_SYSTEM_ERROR_CODES) {
      expect(typeof RETRYABLE_BY_CODE[code]).toBe("boolean");
    }
  });

  it("re-exports branded types and their guards", () => {
    const p = asPath("/uploads");
    expect(typeof p).toBe("string");
    expect(() => assertS3Key("good/key.jpg")).not.toThrow();
    expect(() => assertS3Key("")).toThrow(TypeError);
    expect(() => assertS3Key("/leading")).toThrow(TypeError);
    expect(() => assertS3Key("a/../b")).toThrow(TypeError);
  });

  it("re-exports the shadcn `cn` utility", () => {
    expect(cn("px-2", "px-4")).toBe("px-4"); // tailwind-merge collapses conflicts
    expect(cn("text-red-500", false && "hidden")).toBe("text-red-500");
  });
});
