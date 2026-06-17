import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Radix UI requires ResizeObserver and IntersectionObserver, which jsdom
// does not implement. Stub them with no-ops so components that depend on
// Radix (file-actions uses DropdownMenu + AlertDialog) can render.
// ---------------------------------------------------------------------------

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class StubIntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

globalThis.ResizeObserver =
  StubResizeObserver as unknown as typeof globalThis.ResizeObserver;
globalThis.IntersectionObserver =
  StubIntersectionObserver as unknown as typeof globalThis.IntersectionObserver;

// Radix also calls scrollIntoView on focusable elements; jsdom doesn't
// implement it natively. Stub it on Element.prototype to avoid crashes.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function (): void {};
}

// matchMedia is used by some Radix components for responsive behavior.
// jsdom returns "matches: false" by default which can break primitives
// that check media queries before rendering.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Auto-cleanup DOM after each test (React Testing Library v16 no
// longer runs cleanup automatically; we must opt in). Also reset
// the body-level pointer-events lock that Radix overlays set, so
// the next test isn't blocked by a leftover overlay.
afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = "";
  document.body.style.overflow = "";
});
