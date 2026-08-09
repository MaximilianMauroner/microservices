import { redirect } from "@tanstack/react-router";
import { createServerFn, getGlobalStartContext } from "@tanstack/react-start";
import type { PlatformPrincipal } from "@tools-platform/security";
import { safeReturnPath, signInLocation } from "./lib/auth-return-path.js";

export const getCurrentPrincipal = createServerFn({ method: "GET" }).handler(
  async (): Promise<PlatformPrincipal | undefined> =>
    getGlobalStartContext()?.principal
);

export async function requireRouteSession(locationHref: string) {
  const principal = await getCurrentPrincipal();
  if (!principal) {
    throw redirect({
      href: signInLocation(safeReturnPath(locationHref), "session_required")
    });
  }
  return principal;
}
