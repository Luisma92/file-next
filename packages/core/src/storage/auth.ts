/**
 * `withAuth` — the Higher-Order Function that wraps a server
 * action or route handler with an auth resolution step.
 *
 * Design reference: `sdd/file-next/design` §F, asuncion #2.
 *
 * Shape:
 *   const protected = withAuth<MyContext>(
 *     async (ctx) => await resolveSession(ctx.req),  // null → 401
 *     async (ctx, req) => await doWork(ctx, req),
 *   );
 *
 * The resolver is the only thing that knows how to map a request
 * to an auth context (Clerk, Auth.js, custom JWT, your own DB —
 * whatever). The handler is the only thing that knows what to do
 * with the context. `withAuth` is the layer that ties them
 * together and short-circuits to 401 on unauthenticated requests.
 *
 * The auth context is generic (`<C extends AuthContext>`) so
 * consumers can attach their own fields (orgId, subscription
 * tier, feature flags, ...). The minimum contract is
 * `AuthContext` (userId, tenantId, roles) so the rest of the
 * library can assume those exist when present.
 *
 * Composes with both Server Actions and Route Handlers because
 * the input/output types are the Web Fetch API Request/Response
 * (which Next.js exposes on both transports).
 */
import type { AuthContext } from "./auth-types";

/** The minimal context passed to the resolver. */
export interface RequestContext {
  readonly req: Request;
}

/**
 * Wrap a handler with an auth resolver. If the resolver returns
 * `null`, the wrapper short-circuits with a 401 Response. Otherwise
 * the handler is invoked with the resolved context.
 *
 * Generic over `C extends AuthContext` so consumers can extend
 * the context (e.g. add `orgId`, `subscriptionTier`).
 */
export const withAuth = <C extends AuthContext>(
  resolve: (ctx: RequestContext) => Promise<C | null>,
  handler: (ctx: C, req: Request) => Promise<Response>,
): ((req: Request) => Promise<Response>) => {
  return async (req: Request): Promise<Response> => {
    const context = await resolve({ req });
    if (context === null) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return handler(context, req);
  };
};
