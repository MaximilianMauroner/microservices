export type SignInReason = "session_required" | "session_expired";

export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  try {
    const url = new URL(value, "https://return-path.invalid");
    if (url.origin !== "https://return-path.invalid") return "/";
    if (url.pathname === "/sign-in" || url.pathname.startsWith("/api/auth")) {
      return "/";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export function signInLocation(
  returnTo: unknown,
  reason: SignInReason
): string {
  const search = new URLSearchParams({
    returnTo: safeReturnPath(returnTo),
    reason
  });
  return `/sign-in?${search}`;
}
