import { describe, it, expect, expectTypeOf } from "vitest";
import {
  ok,
  err,
  map,
  mapErr,
  andThen,
  unwrap,
  unwrapOr,
  type Result,
} from "@/types/result";
import { FileSystemError } from "@/errors";

const makeErr = (message = "nope"): FileSystemError =>
  new FileSystemError({ code: "Unknown", message, retryable: false });

// Helpers to produce typed Results without the verbose generic syntax.
// ok/err's signatures intentionally return `Result<T, never>` and
// `Result<never, E>`. Widening to `Result<T, E>` happens at the
// annotation site via subtyping (`never` is the bottom type).
const okN = (n: number): Result<number, FileSystemError> => ok(n);
const errN = (e: FileSystemError): Result<number, FileSystemError> => err(e);

describe("T-006: Result<T, E>", () => {
  describe("constructors", () => {
    it("ok() yields { ok: true, value }", () => {
      expect(ok(42)).toEqual({ ok: true, value: 42 });
    });

    it("err() yields { ok: false, error }", () => {
      const e = makeErr();
      expect(err(e)).toEqual({ ok: false, error: e });
    });
  });

  describe("discriminated union narrows in consumer code", () => {
    function consume(r: Result<number, FileSystemError>): string {
      switch (r.ok) {
        case true:
          return `value=${r.value}`;
        case false:
          return `error=${r.error.message}`;
      }
    }

    it("narrowing on the .ok discriminator compiles and runs", () => {
      expect(consume(okN(1))).toBe("value=1");
      expect(consume(errN(makeErr("nope")))).toBe("error=nope");
    });

    it("the value branch has T and the error branch has E", () => {
      const r: Result<number, FileSystemError> = okN(1);
      if (r.ok) {
        expectTypeOf(r.value).toEqualTypeOf<number>();
      } else {
        expectTypeOf(r.error).toEqualTypeOf<FileSystemError>();
      }
      expectTypeOf(r).toMatchTypeOf<
        { ok: true; value: number } | { ok: false; error: FileSystemError }
      >();
    });
  });

  describe("map", () => {
    it("transforms the value on ok", () => {
      const r: Result<number, FileSystemError> = okN(2);
      expect(map(r, (x) => x * 3)).toEqual({ ok: true, value: 6 });
    });

    it("leaves err untouched (does not call f)", () => {
      const e = makeErr();
      const r: Result<number, FileSystemError> = errN(e);
      const f = (): never => {
        throw new Error("map must not call f on err");
      };
      expect(map(r, f)).toEqual({ ok: false, error: e });
    });

    it("chains left-to-right (map . map = map(f . g))", () => {
      const r: Result<number, FileSystemError> = okN(1);
      const a = map(map(r, (x) => x + 1), (x) => x * 10);
      expect(a).toEqual({ ok: true, value: 20 });
    });
  });

  describe("mapErr", () => {
    it("transforms the error on err", () => {
      const e = makeErr("nope");
      const r: Result<number, FileSystemError> = errN(e);
      const mapped = mapErr(r, (err) => new Error(`wrapped: ${err.message}`));
      expect(mapped.ok).toBe(false);
      if (!mapped.ok) {
        expect(mapped.error).toBeInstanceOf(Error);
        expect((mapped.error as Error).message).toBe("wrapped: nope");
      }
    });

    it("leaves ok untouched (does not call f)", () => {
      const r: Result<number, FileSystemError> = okN(1);
      const out = mapErr(r, () => {
        throw new Error("mapErr must not call f on ok");
      });
      expect(out).toEqual({ ok: true, value: 1 });
    });
  });

  describe("andThen (chain Result-returning functions)", () => {
    it("calls f with the value on ok and returns its Result", () => {
      const r: Result<number, FileSystemError> = okN(5);
      const out = andThen(r, (x) => (x > 0 ? okN(x * 2) : errN(makeErr("non-positive"))));
      expect(out).toEqual({ ok: true, value: 10 });
    });

    it("short-circuits on err (does not call f)", () => {
      const e = makeErr("upstream");
      const r: Result<number, FileSystemError> = errN(e);
      let called = false;
      const out = andThen(r, (x) => {
        called = true;
        return okN(x);
      });
      expect(called).toBe(false);
      expect(out).toEqual({ ok: false, error: e });
    });

    it("propagates a downstream err", () => {
      const r: Result<number, FileSystemError> = okN(1);
      const out = andThen(r, () => errN(makeErr("downstream")));
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error.message).toBe("downstream");
    });
  });

  describe("unwrap", () => {
    it("returns the value on ok", () => {
      const r: Result<number, FileSystemError> = okN(7);
      expect(unwrap(r)).toBe(7);
    });

    it("throws the error on err", () => {
      const r: Result<number, FileSystemError> = errN(makeErr("kaboom"));
      expect(() => unwrap(r)).toThrow(FileSystemError);
      expect(() => unwrap(r)).toThrow("kaboom");
    });
  });

  describe("unwrapOr", () => {
    it("returns the value on ok", () => {
      const r: Result<number, FileSystemError> = okN(3);
      expect(unwrapOr(r, 99)).toBe(3);
    });

    it("returns the fallback on err", () => {
      const r: Result<number, FileSystemError> = errN(makeErr());
      expect(unwrapOr(r, 99)).toBe(99);
    });
  });

  describe("JSON-serializability (RSC pass-through)", () => {
    it("serializes a Result via JSON.stringify without losing the discriminator", () => {
      const r: Result<number, FileSystemError> = errN(makeErr("io"));
      const j = JSON.parse(JSON.stringify(r)) as {
        ok: boolean;
        error: { message: string };
      };
      expect(j.ok).toBe(false);
      expect(j.error.message).toBe("io");
    });

    it("serializes an ok result cleanly", () => {
      const r: Result<number, FileSystemError> = okN(42);
      const j = JSON.parse(JSON.stringify(r)) as { ok: boolean; value: number };
      expect(j).toEqual({ ok: true, value: 42 });
    });
  });
});
