import { describe, it, expect } from "vitest";

/**
 * Smoke test for the packages/core vitest project.
 *
 * If the per-package vitest.config.ts is correctly wired up (jsdom
 * environment + setup file loaded), the jest-dom matchers from
 * @testing-library/jest-dom/vitest are available on expect and a
 * real DOM element round-trips through them. This test would fail
 * with a TypeError ("toBeInTheDocument is not a function") if the
 * setup file is not loaded, and with a ReferenceError
 * ("document is not defined") if the jsdom environment is missing.
 */
describe("T-003: packages/core vitest project", () => {
  it("loads jest-dom matchers via the per-package setup file", () => {
    const element = document.createElement("div");
    element.textContent = "file-next";
    document.body.appendChild(element);

    expect(element).toBeInTheDocument();
    expect(element.textContent).toBe("file-next");
  });
});
