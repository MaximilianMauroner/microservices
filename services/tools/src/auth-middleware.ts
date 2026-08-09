import { redirect } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import type { PlatformPrincipal } from "@tools-platform/security";
import { safeReturnPath, signInLocation } from "./lib/auth-return-path.js";

type PlatformFunctionContext = {
  request: Request;
  principal?: PlatformPrincipal;
};

export const requirePlatformSession = createMiddleware({ type: "function" })
  .server(async ({ context, next }) => {
    const platformContext = context as PlatformFunctionContext;
    if (platformContext.principal) {
      return next({ context: { principal: platformContext.principal } });
    }
    throw redirect({
      href: signInLocation(
        returnPathFromRequest(platformContext.request),
        "session_expired"
      )
    });
  });

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
