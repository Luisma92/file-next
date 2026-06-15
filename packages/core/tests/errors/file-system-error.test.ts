import { describe, it, expect, expectTypeOf } from "vitest";
import {
  FileSystemError,
  FILE_SYSTEM_ERROR_CODES,
  RETRYABLE_BY_CODE,
  fromAws,
  fromPg,
  fromSqlite,
  type FileSystemErrorCode,
} from "@/errors";

describe("T-007a: FileSystemError class + 11 codes", () => {
  describe("code catalog", () => {
    it("exposes the 11 spec codes as a readonly tuple", () => {
      expect(FILE_SYSTEM_ERROR_CODES).toEqual([
        "NotFound",
        "Forbidden",
        "Conflict",
        "QuotaExceeded",
        "NetworkError",
        "InternalError",
        "ValidationError",
        "MissingConfig",
        "PayloadTooLarge",
        "UnsupportedMediaType",
        "Unauthorized",
      ]);
    });

    it("FileSystemErrorCode is the union of those 11 literals", () => {
      // If a future code is added to FILE_SYSTEM_ERROR_CODES without
      // updating the RETRYABLE_BY_CODE map, this test catches it.
      expect(FILE_SYSTEM_ERROR_CODES).toHaveLength(11);
      expectTypeOf<FileSystemErrorCode>().toEqualTypeOf<
        | "NotFound"
        | "Forbidden"
        | "Conflict"
        | "QuotaExceeded"
        | "NetworkError"
        | "InternalError"
        | "ValidationError"
        | "MissingConfig"
        | "PayloadTooLarge"
        | "UnsupportedMediaType"
        | "Unauthorized"
      >();
    });

    it("every code has a retryable entry (no missing keys)", () => {
      for (const code of FILE_SYSTEM_ERROR_CODES) {
        expect(typeof RETRYABLE_BY_CODE[code]).toBe("boolean");
      }
    });

    it("forbids codes outside the catalog at the type level", () => {
      // @ts-expect-error - "YoloError" is not a FileSystemErrorCode
      const _bad: FileSystemErrorCode = "YoloError";
    });
  });

  describe.each(FILE_SYSTEM_ERROR_CODES)(
    "FileSystemError code: %s",
    (code) => {
      it("constructs with the catalog's retryable flag and round-trips through toJSON", () => {
        const retryable = RETRYABLE_BY_CODE[code];
        const e = new FileSystemError({ code, message: `boom: ${code}`, retryable });

        expect(e).toBeInstanceOf(Error);
        expect(e).toBeInstanceOf(FileSystemError);
        expect(e.name).toBe("FileSystemError");
        expect(e.code).toBe(code);
        expect(e.retryable).toBe(retryable);
        expect(e.message).toBe(`boom: ${code}`);

        const j = e.toJSON();
        expect(j).toEqual({
          name: "FileSystemError",
          code,
          message: `boom: ${code}`,
          retryable,
        });
      });
    },
  );

  describe("cause handling", () => {
    it("preserves the cause through the constructor and toJSON", () => {
      const e = new FileSystemError({
        code: "NotFound",
        message: "S3 says no",
        retryable: false,
        cause: { code: "NoSuchKey", message: "The specified key does not exist." },
      });

      expect(e.cause).toEqual({
        code: "NoSuchKey",
        message: "The specified key does not exist.",
      });

      const j = e.toJSON();
      expect(j.cause).toEqual({
        code: "NoSuchKey",
        message: "The specified key does not exist.",
      });
    });

    it("omits the cause key entirely when not provided (stable shape)", () => {
      const e = new FileSystemError({
        code: "Conflict",
        message: "dup",
        retryable: false,
      });
      const j = e.toJSON();
      expect("cause" in j).toBe(false);
    });
  });

  describe("retryable flag distribution", () => {
    it("5xx-ish / network-ish codes are retryable", () => {
      expect(RETRYABLE_BY_CODE.NetworkError).toBe(true);
      expect(RETRYABLE_BY_CODE.InternalError).toBe(true);
      expect(RETRYABLE_BY_CODE.QuotaExceeded).toBe(true);
    });

    it("auth/validation/state codes are non-retryable", () => {
      expect(RETRYABLE_BY_CODE.NotFound).toBe(false);
      expect(RETRYABLE_BY_CODE.Forbidden).toBe(false);
      expect(RETRYABLE_BY_CODE.Conflict).toBe(false);
      expect(RETRYABLE_BY_CODE.ValidationError).toBe(false);
      expect(RETRYABLE_BY_CODE.MissingConfig).toBe(false);
      expect(RETRYABLE_BY_CODE.PayloadTooLarge).toBe(false);
      expect(RETRYABLE_BY_CODE.UnsupportedMediaType).toBe(false);
      expect(RETRYABLE_BY_CODE.Unauthorized).toBe(false);
    });
  });
});

/* ---------------------------------------------------------------- *
 * T-007b: fromAws / fromPg / fromSqlite static mappers             *
 * ---------------------------------------------------------------- */

const makeAwsError = (
  name: string,
  message: string,
  httpStatusCode?: number,
): Record<string, unknown> => {
  const e: Record<string, unknown> = { name, message };
  if (httpStatusCode !== undefined) {
    e.$metadata = { httpStatusCode };
  }
  return e;
};

const makePgError = (code: string, message: string): { code: string; message: string } => ({
  code,
  message,
});

const makeSqliteError = (code: string, message: string): { code: string; message: string } => ({
  code,
  message,
});

describe("T-007b: fromAws / fromPg / fromSqlite mappers", () => {
  describe("fromAws", () => {
    it("S3 NoSuchKey -> NotFound (retryable: false, cause.code preserved)", () => {
      const e = fromAws(makeAwsError("NoSuchKey", "The specified key does not exist.", 404));
      expect(e).toBeInstanceOf(FileSystemError);
      expect(e.code).toBe("NotFound");
      expect(e.retryable).toBe(false);
      expect(e.cause?.code).toBe("NoSuchKey");
    });

    it("5xx HTTP status -> InternalError (retryable: true)", () => {
      const e = fromAws(makeAwsError("InternalError", "Service unavailable.", 503));
      expect(e.code).toBe("InternalError");
      expect(e.retryable).toBe(true);
      expect(e.cause?.code).toBe("InternalError");
    });

    it("4xx AccessDenied -> Forbidden (retryable: false)", () => {
      const e = fromAws(makeAwsError("AccessDenied", "Access Denied.", 403));
      expect(e.code).toBe("Forbidden");
      expect(e.retryable).toBe(false);
    });

    it("SlowDown -> QuotaExceeded (retryable: true) [deviation: spec has no RateLimited]", () => {
      const e = fromAws(makeAwsError("SlowDown", "Please reduce your request rate.", 503));
      expect(e.code).toBe("QuotaExceeded");
      expect(e.retryable).toBe(true);
      expect(e.cause?.code).toBe("SlowDown");
    });

    it("name-based mapping wins over HTTP status (NoSuchKey on 500 -> NotFound)", () => {
      const e = fromAws(makeAwsError("NoSuchKey", "missing", 500));
      expect(e.code).toBe("NotFound");
      expect(e.retryable).toBe(false);
    });

    it("non-Error input (string) is still mapped to a FileSystemError", () => {
      const e = fromAws("boom");
      expect(e).toBeInstanceOf(FileSystemError);
      expect(e.code).toBe("InternalError");
    });

    it("is also exposed as a static method on FileSystemError", () => {
      const e = FileSystemError.fromAws(makeAwsError("NoSuchKey", "x", 404));
      expect(e.code).toBe("NotFound");
    });
  });

  describe("fromPg", () => {
    it("23505 (unique_violation) -> Conflict (retryable: false)", () => {
      const e = fromPg(makePgError("23505", "duplicate key value violates unique constraint"));
      expect(e.code).toBe("Conflict");
      expect(e.retryable).toBe(false);
      expect(e.cause?.code).toBe("23505");
    });

    it("23514 (check_violation) -> ValidationError [deviation: design said InvalidPath]", () => {
      const e = fromPg(makePgError("23514", "new row for relation violates check constraint"));
      expect(e.code).toBe("ValidationError");
      expect(e.retryable).toBe(false);
    });

    it("unknown SQLSTATE -> InternalError (retryable: true, cause preserved)", () => {
      const e = fromPg(makePgError("42P01", "relation does not exist"));
      expect(e.code).toBe("InternalError");
      expect(e.retryable).toBe(true);
      expect(e.cause?.code).toBe("42P01");
    });

    it("non-Error input is mapped", () => {
      const e = fromPg(null);
      expect(e).toBeInstanceOf(FileSystemError);
      expect(e.code).toBe("InternalError");
    });

    it("is also exposed as a static method on FileSystemError", () => {
      const e = FileSystemError.fromPg(makePgError("23505", "x"));
      expect(e.code).toBe("Conflict");
    });
  });

  describe("fromSqlite", () => {
    it("SQLITE_CONSTRAINT_UNIQUE -> Conflict (retryable: false)", () => {
      const e = fromSqlite(makeSqliteError("SQLITE_CONSTRAINT_UNIQUE", "UNIQUE constraint failed"));
      expect(e.code).toBe("Conflict");
      expect(e.retryable).toBe(false);
      expect(e.cause?.code).toBe("SQLITE_CONSTRAINT_UNIQUE");
    });

    it("SQLITE_CONSTRAINT_PRIMARYKEY -> Conflict (retryable: false)", () => {
      const e = fromSqlite(makeSqliteError("SQLITE_CONSTRAINT_PRIMARYKEY", "PRIMARY KEY constraint failed"));
      expect(e.code).toBe("Conflict");
      expect(e.retryable).toBe(false);
    });

    it("unknown SQLite code -> InternalError (retryable: true)", () => {
      const e = fromSqlite(makeSqliteError("SQLITE_BUSY", "database is locked"));
      expect(e.code).toBe("InternalError");
      expect(e.retryable).toBe(true);
      expect(e.cause?.code).toBe("SQLITE_BUSY");
    });

    it("is also exposed as a static method on FileSystemError", () => {
      const e = FileSystemError.fromSqlite(makeSqliteError("SQLITE_CONSTRAINT_UNIQUE", "x"));
      expect(e.code).toBe("Conflict");
    });
  });

  describe("round-trip passthrough", () => {
    it("from* returns a FileSystemError as-is (does not re-wrap)", () => {
      const original = new FileSystemError({
        code: "NotFound",
        message: "x",
        retryable: false,
        cause: { code: "NoSuchKey", message: "x" },
      });
      expect(fromAws(original)).toBe(original);
      expect(fromPg(original)).toBe(original);
      expect(fromSqlite(original)).toBe(original);
    });
  });
});
