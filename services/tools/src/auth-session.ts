import { redirect } from "@tanstack/react-router";
import { createServerFn, getGlobalStartContext } from "@tanstack/react-start";
import type { PlatformPrincipal } from "@tools-platform/security";
import { safeReturnPath, signInLocation } from "./lib/auth-return-path.js";
import { grantedProducts, homePath, type GrantableProductId } from "./product-access.js";

export const getCurrentPrincipal = createServerFn({ method: "GET" }).handler(
  async (): Promise<PlatformPrincipal | undefined> =>
    getGlobalStartContext()?.principal
);

export async function requireRouteSession(locationHref: string) {
  const principal = await requireSignedIn(locationHref);
  if (principal.role !== "admin") throw redirect({ href: homePath(principal) });
  return principal;
}

export async function requireSignedIn(locationHref: string) {
  const principal = await getCurrentPrincipal();
  if (!principal) {
    throw redirect({
      href: signInLocation(safeReturnPath(locationHref), "session_required")
    });
  }
  return principal;
}

/** Guards a product page that a member can open with a grant. */
export async function requireProductSession(locationHref: string, product: GrantableProductId) {
  const principal = await requireSignedIn(locationHref);
  if (principal.role !== "admin" && !grantedProducts(principal).includes(product)) {
    throw redirect({ href: homePath(principal) });
  }
  return principal;
}
