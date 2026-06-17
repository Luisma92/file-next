/**
 * Skeleton smoke test for the `@file-next/headless` package.
 *
 * Purpose: prove that the test infrastructure (jsdom, react plugin,
 * jest-dom matchers, workspace project registration) is wired end-
 * to-end BEFORE any of the 5 hooks land. If this fails, the
 * skeleton is broken — the per-hook tests will not be runnable.
 *
 * The test renders a trivial hook (a one-liner `useState`) and
 * asserts the React tree mounts + a setter update propagates. This
 * is intentionally MINIMAL (no real hook under test) — its job is
 * to catch env / config regressions, not to test real behavior.
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";

describe("headless skeleton", () => {
  it("renders a trivial hook and propagates state updates inside jsdom", () => {
    const { result } = renderHook(() => useState<number>(0));
    expect(result.current[0]).toBe(0);
    act(() => {
      result.current[1](1);
    });
    expect(result.current[0]).toBe(1);
  });
});
