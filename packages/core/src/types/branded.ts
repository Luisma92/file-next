/**
 * Branded string types and their constructors/guards.
 *
 * Brands are TypeScript-only fictions: a `Path` and an `S3Key` are
 * both strings at runtime, but the type system treats them as
 * distinct nominal types so the compiler catches accidental
 * cross-assignment (e.g. passing an S3Key where a TenantId is
 * expected).
 *
 * Conventions:
 *   - `as*` is a zero-cost cast: trust the caller, brand the value.
 *     Use it at trust boundaries you have already validated.
 *   - `assert*` is a runtime guard: throws TypeError on invalid
 *     input. Use it at the edge (parsing user/env input).
 *
 * Validation rules are intentionally minimal in v0.1 and can be
 * tightened as the spec evolves. None of them touch the network or
 * allocate; they are safe in hot paths.
 */

export type Path = string & { readonly __brand: "Path" };
export type Prefix = string & { readonly __brand: "Prefix" };
export type S3Key = string & { readonly __brand: "S3Key" };
export type TenantId = string & { readonly __brand: "TenantId" };
export type UserId = string & { readonly __brand: "UserId" };

/**
 * POSIX file path. Non-empty, '/' is allowed as the root.
 */
export const asPath = (s: string): Path => s as Path;
export const assertPath = (s: string): Path => {
  if (s.length === 0) {
    throw new TypeError("Path must be a non-empty string");
  }
  return s as Path;
};

/**
 * S3 prefix. Empty string is the root prefix. Non-empty prefixes
 * MUST end with '/' so concatenation with a key never produces
 * 'usersfile.jpg' by accident.
 */
export const asPrefix = (s: string): Prefix => s as Prefix;
export const assertPrefix = (s: string): Prefix => {
  if (s.length > 0 && !s.endsWith("/")) {
    throw new TypeError(
      `Prefix must end with "/" or be empty: ${JSON.stringify(s)}`,
    );
  }
  return s as Prefix;
};

/**
 * S3 object key. No leading slash, no empty segments, no '..' hops.
 */
export const asS3Key = (s: string): S3Key => s as S3Key;
export const assertS3Key = (s: string): S3Key => {
  if (s.length === 0) {
    throw new TypeError("S3Key must be a non-empty string");
  }
  if (s.startsWith("/")) {
    throw new TypeError(
      `S3Key must not start with a slash: ${JSON.stringify(s)}`,
    );
  }
  if (s.includes("..")) {
    throw new TypeError(
      `S3Key must not contain '..' segments: ${JSON.stringify(s)}`,
    );
  }
  return s as S3Key;
};

/**
 * Tenant identifier. Alphanumerics, dashes, underscores only.
 */
export const asTenantId = (s: string): TenantId => s as TenantId;
export const assertTenantId = (s: string): TenantId => {
  if (s.length === 0 || !/^[a-zA-Z0-9_-]+$/.test(s)) {
    throw new TypeError(`Invalid TenantId: ${JSON.stringify(s)}`);
  }
  return s as TenantId;
};

/**
 * Opaque user identifier. Non-empty; the format is provider-defined.
 */
export const asUserId = (s: string): UserId => s as UserId;
export const assertUserId = (s: string): UserId => {
  if (s.length === 0) {
    throw new TypeError("UserId must be a non-empty string");
  }
  return s as UserId;
};
