import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SignInPanel } from "../src/routes/sign-in.js";

describe("focused authentication card", () => {
  it.each([
    ["sign-in", "Sign in to continue", "Continue with Google"],
    ["unauthorized", "Account not authorized", "Choose another Google account"],
    ["expired", "Session expired", "Continue with Google"]
  ] as const)("renders the %s state", (state, heading, action) => {
    const html = renderToStaticMarkup(<SignInPanel state={state} />);
    expect(html).toContain(heading);
    expect(html).toContain(action);
    expect(html).toContain("Secure session · 7 days");
  });
});
