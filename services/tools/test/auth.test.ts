import { describe, expect, it } from "vitest";
import { isAllowedGoogleProfile, principalFromSession } from "../src/lib/auth.js";
import { safeReturnPath, signInLocation } from "../src/lib/auth-return-path.js";

describe("Google account authorization", () => {
  it("accepts only the configured stable Google subject", () => {
    const profile = {
      sub: "allowed-subject",
      email: "owner@example.com",
      email_verified: true,
      name: "Operator",
      picture: "https://example.test/avatar.png"
    };
    expect(isAllowedGoogleProfile(
      profile,
      "allowed-subject",
      "owner@example.com"
    )).toBe(true);
    expect(isAllowedGoogleProfile(
      { ...profile, sub: "different-subject" },
      "allowed-subject",
      "owner@example.com"
    )).toBe(false);
    expect(isAllowedGoogleProfile(
      { ...profile, email_verified: false },
      "allowed-subject",
      "owner@example.com"
    )).toBe(false);
    expect(isAllowedGoogleProfile(
      { ...profile, email: "someone-else@gmail.com" },
      "allowed-subject",
      "owner@example.com"
    )).toBe(false);
  });

  it("rechecks the configured subject when resolving a session", () => {
    const session = {
      user: { id: "allowed-subject", email: "owner@example.com" }
    };
    expect(principalFromSession(
      session,
      "allowed-subject",
      "owner@example.com"
    )).toEqual({
      subject: "allowed-subject",
      email: "owner@example.com"
    });
    expect(principalFromSession(
      session,
      "different-subject",
      "owner@example.com"
    )).toBeUndefined();
    expect(principalFromSession(
      { user: { id: "allowed-subject", email: "someone-else@gmail.com" } },
      "allowed-subject",
      "owner@example.com"
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
    "https://evil.example/private",
    "//evil.example/private",
    "/sign-in?returnTo=/manage",
    "/api/auth/callback/google",
    "not-a-path",
    undefined
  ])("rejects unsafe or recursive return path %s", (value) => {
    expect(safeReturnPath(value)).toBe("/");
  });
});
