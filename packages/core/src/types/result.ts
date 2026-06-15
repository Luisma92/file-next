/**
 * Discriminated `Result<T, E>` for typed error returns.
 *
 * Why Result over throw at boundaries:
 *   - No `any` at the call site (vs try/catch which loses the type).
 *   - `switch (r.ok)` narrows the type in consumer code.
 *   - The wire shape `{ ok, value | error }` is JSON-serializable,
 *     so it survives the RSC boundary without an extra DTO.
 *   - Helpers (`map`, `andThen`, `unwrap`) make the common shapes
 *     (chain, bail-out, recover) terse and exhaustive.
 *
 * The default error type is `FileSystemError` (see `@/errors`).
 * Consumers can specialize: `Result<User, ZodError>`.
 *
 * All helpers are pure functions; they do NOT allocate closures in
 * hot paths beyond what the spec demands (no `try`/`catch` wrapping).
 */

import { FileSystemError } from "@/errors";

export type Result<T, E = FileSystemError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const map = <T, U, E>(
  r: Result<T, E>,
  f: (t: T) => U,
): Result<U, E> => (r.ok ? ok(f(r.value)) : r);

export const mapErr = <T, E, F>(
  r: Result<T, E>,
  f: (e: E) => F,
): Result<T, F> => (r.ok ? r : err(f(r.error)));

export const andThen = <T, U, E>(
  r: Result<T, E>,
  f: (t: T) => Result<U, E>,
): Result<U, E> => (r.ok ? f(r.value) : r);

export const unwrap = <T, E>(r: Result<T, E>): T => {
  if (r.ok) return r.value;
  throw r.error;
};

export const unwrapOr = <T, E>(r: Result<T, E>, fallback: T): T =>
  r.ok ? r.value : fallback;
