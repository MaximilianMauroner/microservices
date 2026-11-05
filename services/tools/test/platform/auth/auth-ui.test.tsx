import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SignInPanel } from "../../../app/routes/sign-in.js";
import { consentDestination } from "../../../app/routes/consent.js";

describe("focused authentication card", () => {
  it.each([
    ["sign-in", "Sign in to Tools", "Continue with Google"],
    ["unauthorized", "This account has no access", "Use another Google account"],
    ["expired", "Session expired", "Continue with Google"]
  ] as const)("renders the %s state", (state, heading, action) => {
    const html = renderToStaticMarkup(<SignInPanel state={state} />);
    expect(html).toContain(heading);
    expect(html).toContain(action);
    expect(html).toContain("The session lasts 7 days on this device.");
  });
});

describe("consent destination", () => {
  it.each([
    ["https://evil.example/callback", "evil.example"],
    ["https://claude.ai/api/mcp/auth_callback", "claude.ai"],
    ["http://127.0.0.1:43123/callback", "an app on this computer"],
    ["com.lab4code.kitchen:/oauth", "the app com.lab4code.kitchen"],
    ["not a url", undefined]
  ] as const)("names where %s sends the access", (redirectUri, shown) => {
    expect(consentDestination(redirectUri)).toBe(shown);
  });
});
