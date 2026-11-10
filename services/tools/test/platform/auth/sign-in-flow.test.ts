import { describe, expect, it } from "vitest";
import { signInFlow } from "../../../platform/auth/sign-in-flow.js";

const nativeRequest = new URLSearchParams({
  client_id: "pantrino",
  redirect_uri: "com.lab4code.pantrino:/oauth",
  response_type: "code",
  scope: "openid profile email offline_access",
  state: '"native-state"',
  code_challenge: "native-pkce-challenge",
  code_challenge_method: "S256",
  nonce: "12345",
  prompt: "login select_account consent",
  exp: "1794050000",
  ba_iat: "1794049400000",
  ba_pl: "internal-session",
  sig: "signed-query"
});
nativeRequest.append("resource", "https://tools.example.test/api/kitchen/mobile");
nativeRequest.append("resource", "https://tools.example.test/api/mcp");
for (const key of [...nativeRequest.keys()]) nativeRequest.append("ba_param", key);

describe("sign-in continuation", () => {
  it("returns Google sign-in to native authorization with state and PKCE intact", () => {
    const flow = signInFlow(`?${nativeRequest}`);
    const callback = new URL(flow.callbackURL, "https://tools.example.test");

    expect(callback.origin).toBe("https://tools.example.test");
    expect(callback.pathname).toBe("/api/auth/oauth2/authorize");
    expect(Object.fromEntries(callback.searchParams)).toMatchObject({
      client_id: "pantrino",
      redirect_uri: "com.lab4code.pantrino:/oauth",
      response_type: "code",
      scope: "openid profile email offline_access",
      state: '"native-state"',
      code_challenge: "native-pkce-challenge",
      code_challenge_method: "S256",
      nonce: "12345",
      prompt: "consent"
    });
    expect(callback.searchParams.getAll("resource")).toEqual([
      "https://tools.example.test/api/kitchen/mobile",
      "https://tools.example.test/api/mcp"
    ]);
    for (const key of ["sig", "exp", "ba_iat", "ba_pl", "ba_param"]) {
      expect(callback.searchParams.has(key)).toBe(false);
    }
  });

  it("keeps the complete signed request after a Google error so retry can authorize the app", () => {
    const failedRequest = new URLSearchParams(nativeRequest);
    failedRequest.set("error", "access_denied");
    const flow = signInFlow(failedRequest.toString());
    const retry = new URL(flow.errorCallbackURL, "https://tools.example.test");

    expect(retry.pathname).toBe("/sign-in");
    expect([...retry.searchParams]).toEqual([...nativeRequest]);
    expect(signInFlow(retry.search).callbackURL).toBe(flow.callbackURL);
  });

  it("does not send an existing Tools session to the dashboard during native reauthentication", () => {
    expect(signInFlow(nativeRequest.toString()).authenticatedRedirect).toBeUndefined();
  });

  it("does not repeat a completed login prompt when consent was not requested", () => {
    const request = new URLSearchParams(nativeRequest);
    request.set("prompt", "login select_account");
    const callback = new URL(signInFlow(request.toString()).callbackURL, "https://tools.example.test");
    expect(callback.searchParams.has("prompt")).toBe(false);
  });

  it("keeps the ordinary website destination for new and existing sessions", () => {
    expect(signInFlow("?returnTo=%2Fkitchen%3Fweek%3Dnext%23meals")).toEqual({
      callbackURL: "/kitchen?week=next#meals",
      errorCallbackURL: "/sign-in?returnTo=%2Fkitchen%3Fweek%3Dnext%23meals",
      authenticatedRedirect: "/kitchen?week=next#meals"
    });
  });

  it.each(["https://evil.example/", "//evil.example/", "/api/auth/oauth2/authorize", "/sign-in", "/app-review"])(
    "rejects unsafe website destination %s",
    (returnTo) => {
      const flow = signInFlow(new URLSearchParams({ returnTo }).toString());
      expect(flow.callbackURL).toBe("/");
      expect(flow.authenticatedRedirect).toBe("/");
    }
  );

  it("keeps signed callbacks on the authorization endpoint even with an external returnTo", () => {
    const request = new URLSearchParams(nativeRequest);
    request.set("returnTo", "https://evil.example/");
    const callback = new URL(signInFlow(request.toString()).callbackURL, "https://tools.example.test");
    expect(callback.origin).toBe("https://tools.example.test");
    expect(callback.pathname).toBe("/api/auth/oauth2/authorize");
    expect(callback.searchParams.has("returnTo")).toBe(false);
  });
});
