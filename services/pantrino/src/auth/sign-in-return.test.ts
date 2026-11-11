import { describe, expect, it } from "vitest";
import { redirectSystemPath } from "../app/+native-intent";

describe("incoming links", () => {
  it("keeps the router off the sign-in return link in each form the system can send", () => {
    for (const path of ["com.lab4code.pantrino:/oauth?code=abc&state=x", "com.lab4code.pantrino:///oauth?code=abc", "/oauth?code=abc", "oauth"]) {
      expect(redirectSystemPath({ path, initial: false }), path).toBeNull();
      expect(redirectSystemPath({ path, initial: true }), path).toBe("/");
    }
  });

  it("passes every other link through", () => {
    for (const path of ["com.lab4code.pantrino:/kitchen/abc", "/shopping?week=2026-11-02", "/oauthish"]) {
      expect(redirectSystemPath({ path, initial: false })).toBe(path);
    }
  });
});
