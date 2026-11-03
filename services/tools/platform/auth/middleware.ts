import { redirect } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import type { PlatformPrincipal } from "#security";
import { safeReturnPath, signInLocation } from "./return-path.js";
import { homePath, principalSeesProduct, type GrantableProductId } from "../access/product-access.js";

type PlatformFunctionContext = {
  request: Request;
  principal?: PlatformPrincipal;
};

export const requirePlatformSession = sessionMiddleware((principal) => principal.role === "admin");

/** Lets every signed-in person call a server function, whatever products they can open. */
export const requireSignedInSession = sessionMiddleware(() => true);

/** Lets the admin and every member with a grant for the product call its server functions. */
export function requireProductAccess(product: GrantableProductId) {
  return sessionMiddleware((principal) => principalSeesProduct(principal, product));
}

function sessionMiddleware(allows: (principal: PlatformPrincipal) => boolean) {
  return createMiddleware({ type: "function" })
    .server(async ({ context, next }) => {
      const { principal, request } = context as PlatformFunctionContext;
      if (principal && allows(principal)) return next({ context: { principal } });
      if (principal) throw redirect({ href: homePath(principal) });
      throw redirect({ href: signInLocation(returnPathFromRequest(request), "session_expired") });
    });
}

function returnPathFromRequest(request: Request): string {
  const referer = request.headers.get("referer");
  if (!referer) return "/";
  try {
    const requestUrl = new URL(request.url);
    const refererUrl = new URL(referer);
    if (refererUrl.origin !== requestUrl.origin) return "/";
    return safeReturnPath(
      `${refererUrl.pathname}${refererUrl.search}${refererUrl.hash}`
    );
  } catch {
    return "/";
  }
}
