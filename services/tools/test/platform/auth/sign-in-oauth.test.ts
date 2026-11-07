import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { oauthProvider } from "@better-auth/oauth-provider";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { expect, it, vi } from "vitest";
import { signInFlow } from "../../../platform/auth/sign-in-flow.js";

it("returns a wildcard Google callback through consent to the native app with PKCE", async () => {
  const origin = "https://tools.example.test";
  const auth = betterAuth({
    baseURL: origin,
    basePath: "/api/auth",
    trustedOrigins: [origin],
    secret: "integration-test-secret-with-32-characters",
    account: { storeStateStrategy: "cookie", storeAccountCookie: false, encryptOAuthTokens: true },
    socialProviders: {
      google: {
        clientId: "fake-google-client",
        clientSecret: "fake-google-secret",
        prompt: "select_account",
        getUserInfo: async () => ({
          user: { id: "subject", name: "Person", email: "person@example.test", emailVerified: true },
          data: { sub: "subject", email: "person@example.test", email_verified: true }
        })
      }
    },
    plugins: [oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/consent",
      disableJwtPlugin: true,
      grantTypes: ["authorization_code", "refresh_token"],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true
    }), tanstackStartCookies()]
  });
  const context = await auth.$context;
  vi.spyOn(context.socialProviders.find((provider) => provider.id === "google")!, "validateAuthorizationCode")
    .mockResolvedValue({ accessToken: "fake-google-access", idToken: "fake-id-token" });
  const registered = await auth.handler(new Request(`${origin}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Pantrino", redirect_uris: ["com.lab4code.pantrino:/oauth"],
      token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"]
    })
  }));
  const { client_id: clientId } = await registered.json() as { client_id: string };
  const verifier = "a".repeat(43);
  const request = new URLSearchParams({
    client_id: clientId, redirect_uri: "com.lab4code.pantrino:/oauth", response_type: "code",
    scope: "openid profile email offline_access", state: "native-state", prompt: "login consent",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256"
  });
  const login = await auth.handler(new Request(`${origin}/api/auth/oauth2/authorize?${request}`, {
    headers: { accept: "text/html", "sec-fetch-mode": "navigate" }
  }));
  const loginLocation = new URL(login.headers.get("location")!, origin);
  expect(loginLocation.pathname).toBe("/sign-in");
  const flow = signInFlow(loginLocation.search);
  const google = await auth.handler(new Request(`${origin}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, accept: "*/*", "sec-fetch-mode": "cors" },
    body: JSON.stringify({ provider: "google", ...flow, oauth_query: loginLocation.search.slice(1) })
  }));
  const googleBody = await google.json() as { url: string };
  const googleState = new URL(googleBody.url).searchParams.get("state")!;
  const callback = await auth.handler(new Request(`${origin}/api/auth/callback/google?code=fake-code&state=${googleState}`, {
    headers: { accept: "*/*", cookie: cookies(google) }
  }));
  expect(callback.status).toBe(302);
  const continuation = new URL(callback.headers.get("location")!, origin);
  expect(continuation.pathname).not.toBe("/");
  expect(continuation.pathname).toBe("/api/auth/oauth2/authorize");
  const sessionCookie = cookies(callback);
  const consent = await auth.handler(new Request(continuation, {
    headers: { cookie: sessionCookie, accept: "*/*" }
  }));
  expect(consent.status).toBe(302);
  const consentLocation = new URL(consent.headers.get("location")!, origin);
  expect(consentLocation.pathname).toBe("/consent");
  const accepted = await auth.handler(new Request(`${origin}/api/auth/oauth2/consent`, {
    method: "POST",
    headers: { cookie: sessionCookie, "content-type": "application/json", origin },
    body: JSON.stringify({ accept: true, oauth_query: consentLocation.search.slice(1) })
  }));
  const acceptedBody = await accepted.json() as { url: string };
  const nativeCallback = new URL(acceptedBody.url);
  expect(`${nativeCallback.protocol}${nativeCallback.pathname}`).toBe("com.lab4code.pantrino:/oauth");
  expect(nativeCallback.searchParams.get("state")).toBe("native-state");
  const token = await auth.handler(new Request(`${origin}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code: nativeCallback.searchParams.get("code")!,
      redirect_uri: "com.lab4code.pantrino:/oauth", client_id: clientId, code_verifier: verifier
    })
  }));
  expect(token.status, await token.clone().text()).toBe(200);
  expect(await token.json()).toMatchObject({ access_token: expect.any(String), refresh_token: expect.any(String) });
});

function cookies(response: Response) {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}
