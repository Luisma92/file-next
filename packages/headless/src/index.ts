/**
 * Public entry point for `@file-next/headless`.
 *
 * This package is BEHAVIOR-ONLY: 5 React hooks that drive file
 * operations, with all server-side concerns (auth, S3 calls) injected
 * as callback arguments. Consumers wire their own action creators and
 * the headless layer just orchestrates state transitions and the
 * low-level browser APIs (XHR, fetch, reader, AbortController).
 *
 * Why dependency injection:
 *   - Keeps the headless layer free of `import "server-only"` so it
 *     can be used in client components.
 *   - Tests can supply plain async functions as the action callbacks
 *     (no real server, no RSC boundary).
 *   - Consumers can compose their own auth / middleware at the
 *     action-callback layer.
 *
 * Hooks are added incrementally as tasks T-052 through T-056 land.
 * Until then, this file stays empty — the smoke test does not
 * import any hook from here.
 */

export {};
