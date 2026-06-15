import { describe, it, expect, expectTypeOf } from "vitest";
import {
  FileSystemError,
  FILE_SYSTEM_ERROR_CODES,
  RETRYABLE_BY_CODE,
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
