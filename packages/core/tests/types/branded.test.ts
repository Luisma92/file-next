import { describe, it, expect, expectTypeOf } from "vitest";
import {
  asPath,
  asPrefix,
  asS3Key,
  asTenantId,
  asUserId,
  assertPath,
  assertPrefix,
  assertS3Key,
  assertTenantId,
  assertUserId,
  type Path,
  type Prefix,
  type S3Key,
  type TenantId,
  type UserId,
} from "@/types/branded";

describe("T-005: branded types (Path, Prefix, S3Key, TenantId, UserId)", () => {
  describe("constructors (as*)", () => {
    it("brand strings at the type level but the runtime value is a plain string", () => {
      const a = asS3Key("a/b");
      const b = asS3Key("c/d");

      // The brand is a TypeScript-only fiction; at runtime the value
      // is a plain string and equality is structural.
      expect(typeof a).toBe("string");
      expect(a).toBe("a/b");
      expect(a).not.toBe(b);

      // The type system, however, distinguishes them.
      expectTypeOf<typeof a>().toEqualTypeOf<S3Key>();
      expectTypeOf(a).not.toEqualTypeOf<Path>();
    });

    it("produces distinct nominal types for every brand", () => {
      expectTypeOf<Path>().not.toEqualTypeOf<Prefix>();
      expectTypeOf<Prefix>().not.toEqualTypeOf<S3Key>();
      expectTypeOf<S3Key>().not.toEqualTypeOf<TenantId>();
      expectTypeOf<TenantId>().not.toEqualTypeOf<UserId>();
      expectTypeOf<UserId>().not.toEqualTypeOf<Path>();
    });
  });

  describe("type-level rejection (no implicit cross-assignment)", () => {
    it("forbids assigning an S3Key to a Path slot", () => {
      // @ts-expect-error - S3Key is not assignable to Path
      const _bad: Path = asS3Key("a/b");
    });

    it("forbids assigning a TenantId to a UserId slot", () => {
      // @ts-expect-error - TenantId is not assignable to UserId
      const _bad: UserId = asTenantId("acme");
    });

    it("forbids assigning a Prefix to an S3Key slot", () => {
      // @ts-expect-error - Prefix is not assignable to S3Key
      const _bad: S3Key = asPrefix("users/");
    });
  });

  describe("assert* runtime guards", () => {
    it("assertS3Key throws on empty, leading-slash, and double-dot inputs", () => {
      expect(() => assertS3Key("")).toThrow(TypeError);
      expect(() => assertS3Key("/leading-slash")).toThrow(TypeError);
      expect(() => assertS3Key("has/../dotdot")).toThrow(TypeError);
    });

    it("assertS3Key accepts well-formed keys", () => {
      const key = assertS3Key("users/123/photo.jpg");
      expect(key).toBe("users/123/photo.jpg");
      expectTypeOf(key).toEqualTypeOf<S3Key>();
    });

    it("assertPrefix throws when not ending with a slash (and not empty)", () => {
      expect(() => assertPrefix("users")).toThrow(TypeError);
      // Empty string is the root prefix; allowed.
      expect(assertPrefix("")).toBe("");
    });

    it("assertTenantId throws on empty or non-alphanumeric input", () => {
      expect(() => assertTenantId("")).toThrow(TypeError);
      expect(() => assertTenantId("acme corp!")).toThrow(TypeError);
      expect(() => assertTenantId("acme corp")).toThrow(TypeError);
    });

    it("assertTenantId accepts alphanumerics, dashes, and underscores", () => {
      expect(assertTenantId("acme")).toBe("acme");
      expect(assertTenantId("acme-corp_2")).toBe("acme-corp_2");
    });

    it("assertPath throws on empty input but accepts a single slash", () => {
      expect(() => assertPath("")).toThrow(TypeError);
      expect(assertPath("/")).toBe("/");
      expect(assertPath("users/123/photo.jpg")).toBe("users/123/photo.jpg");
    });

    it("assertUserId throws on empty input but accepts opaque strings", () => {
      expect(() => assertUserId("")).toThrow(TypeError);
      expect(assertUserId("user_abc-123")).toBe("user_abc-123");
    });
  });

  describe("brand composition", () => {
    it("a function that takes an S3Key refuses a raw string", () => {
      function takeKey(k: S3Key): S3Key {
        return k;
      }
      const branded = asS3Key("a/b");
      expect(takeKey(branded)).toBe("a/b");

      // @ts-expect-error - raw string is not assignable to S3Key
      takeKey("a/b");
    });
  });
});
