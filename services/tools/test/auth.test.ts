import { describe, expect, it } from "vitest";
import { isAllowedGoogleProfile, principalFromSession } from "../src/lib/auth.js";
import { safeReturnPath, signInLocation } from "../src/lib/auth-return-path.js";

describe("Google account authorization", () => {
  it("accepts only the configured stable Google subject", () => {
    const profile = {
      sub: "allowed-subject",
      email: "maximilian.mauroner@gmail.com",
      email_verified: true,
      name: "Operator",
      picture: "https://example.test/avatar.png"
    };
    expect(isAllowedGoogleProfile(
      profile,
      "allowed-subject",
      "maximilian.mauroner@gmail.com"
    )).toBe(true);
    expect(isAllowedGoogleProfile(
      { ...profile, sub: "different-subject" },
      "allowed-subject",
      "maximilian.mauroner@gmail.com"
    )).toBe(false);
    expect(isAllowedGoogleProfile(
      { ...profile, email_verified: false },
      "allowed-subject",
      "maximilian.mauroner@gmail.com"
    )).toBe(false);
    expect(isAllowedGoogleProfile(
      { ...profile, email: "someone-else@gmail.com" },
      "allowed-subject",
      "maximilian.mauroner@gmail.com"
    )).toBe(false);
  });

  it("rechecks the configured subject when resolving a session", () => {
    const session = {
      user: { id: "allowed-subject", email: "maximilian.mauroner@gmail.com" }
    };
    expect(principalFromSession(
      session,
      "allowed-subject",
      "maximilian.mauroner@gmail.com"
    )).toEqual({
      subject: "allowed-subject",
      email: "maximilian.mauroner@gmail.com"
    });
    expect(principalFromSession(
      session,
      "different-subject",
      "maximilian.mauroner@gmail.com"
    )).toBeUndefined();
    expect(principalFromSession(
      { user: { id: "allowed-subject", email: "someone-else@gmail.com" } },
      "allowed-subject",
      "maximilian.mauroner@gmail.com"
    )).toBeUndefined();
  });
});

describe("authentication return paths", () => {
  it("preserves same-origin relative routes", () => {
    expect(safeReturnPath("/manage/status?view=all#services"))
      .toBe("/manage/status?view=all#services");
    expect(signInLocation("/review?view=queue", "session_expired"))
      .toBe("/sign-in?returnTo=%2Freview%3Fview%3Dqueue&reason=session_expired");
  });

  it.each([
    ["/a/../money?view=all#balance", "/money?view=all#balance"],
    ["/%2e/money", "/money"],
    ["/manage//status", "/manage//status"],
    ["/money?returnTo=//evil.com#//evil.com", "/money?returnTo=//evil.com#//evil.com"]
  ])("preserves the internal destination for %s", (value, expected) => {
    expect(safeReturnPath(value)).toBe(expected);
    const returnTo = new URL(signInLocation(value, "session_required"), "https://tools.example")
      .searchParams.get("returnTo");
    expect(returnTo).toBe(expected);
  });

  it.each([
    "https://evil.example/private",
    "//evil.example/private",
    "/sign-in?returnTo=/manage",
    "/api/auth/callback/google",
    "/.//evil.com",
    "/a/..//evil.com",
    "/%2e//evil.com",
    "not-a-path",
    undefined
  ])("rejects unsafe or recursive return path %s", (value) => {
    expect(safeReturnPath(value)).toBe("/");
  });

  it.each([
    "/.//evil.example",
    "/a/..//evil.example",
    "/%2e//evil.example",
    "/\\evil.example",
    "/%5Cevil.example"
  ])("keeps the redirect for %s on the app origin", (value) => {
    const origin = "https://tools.example";
    const returnTo = new URL(signInLocation(value, "session_required"), origin)
      .searchParams.get("returnTo");

    expect(returnTo).not.toBeNull();
    expect(new URL(safeReturnPath(value), origin).origin).toBe(origin);
    expect(new URL(returnTo ?? "", origin).origin).toBe(origin);
  });
});
