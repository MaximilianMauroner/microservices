import type { PlatformPrincipal } from "#security";
import { principalSeesProduct } from "./access/product-access.js";

export type AppTokenResolver = (request: Request) => Promise<PlatformPrincipal | undefined>;

/**
 * Serves a native app request for one product. Only the app's bearer token opens it, never a cookie or an MCP token,
 * and the person needs access to the product as on the web.
 */
export async function asAppProduct(request: Request, resolveAppToken: AppTokenResolver, product: string, serve: (who: PlatformPrincipal) => Promise<Response>): Promise<Response> {
  const principal = await resolveAppToken(request);
  if (!principal) return Response.json({ error: "invalid_token" }, { status: 401, headers: { "Cache-Control": "no-store", "WWW-Authenticate": "Bearer" } });
  if (!principalSeesProduct(principal, product)) return Response.json({ error: "forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  return serve(principal);
}
