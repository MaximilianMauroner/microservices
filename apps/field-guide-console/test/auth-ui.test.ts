import { describe, expect, it } from "vitest";
import { agentAuth } from "../src/auth.js";
import type { Authenticator } from "../src/http.js";
import { reviewConsole, reviewSuiteStyles } from "../src/ui.js";
import { responseJson } from "./http-test.js";

const origin = "https://reviews.example";

function authenticatedRequest(value?: string) {
  return new Request(origin, {
    headers: value === undefined ? undefined : { Authorization: value },
  });
}

async function expectRejected(
  auth: Authenticator,
  authorization: string | undefined,
  status: number,
) {
  const result = await auth(authenticatedRequest(authorization));
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected authentication to fail.");
  expect(result.response.status).toBe(status);
  expect(result.response.headers.get("content-type")).toBe(
    "application/json; charset=utf-8",
  );
  return result.response;
}

describe("review UI and authentication", () => {
  it("serves the Access UI, separate scopes, history, evidence, and valid action controls", async () => {
    const response = reviewConsole();
    const html = await response.text();
    expect(html).toContain("Cloudflare Access protects this review desk");
    expect(html).toContain("/cdn-cgi/access/logout");
    expect(html).toContain('data-scope="project"');
    expect(html).toContain('data-scope="global"');
    expect(html).toContain('data-view="history"');
    expect(html).toContain("Evidence");
    expect(html).toContain("confirm_valid");
    expect(html).not.toContain('data-action="edit"');
    expect(reviewSuiteStyles).toContain("@media(max-width:439px)");
    expect(reviewSuiteStyles).toContain("flex-wrap:wrap");
    expect(reviewSuiteStyles).toContain("flex:1 1 calc(33.333% - 4px)");
  });

  it("accepts only an exact agent Bearer credential", async () => {
    const auth = agentAuth("top-secret");
    expect((await auth(authenticatedRequest("Bearer top-secret"))).ok).toBe(true);
    for (const value of [
      undefined,
      "top-secret",
      "bearer top-secret",
      "Bearer  top-secret",
      "Bearer\ttop-secret",
      "Bearer top-secret extra",
      "Bearer wrong",
    ]) {
      const response = await expectRejected(auth, value, 401);
      expect(response.headers.get("www-authenticate")).toBe(
        'Bearer realm="field-guide-console"',
      );
    }

    const unicodeRequest = new Request(origin);
    Object.defineProperty(unicodeRequest, "headers", {
      value: { get: () => "Bearer 𐍈" },
    });
    const unicodeResult = await agentAuth("éx")(unicodeRequest);
    expect(unicodeResult.ok).toBe(false);
    if (unicodeResult.ok)
      throw new Error("Expected Unicode authentication to fail.");
    const unicode = unicodeResult.response;
    expect(unicode.status).toBe(401);
    expect(await responseJson(unicode)).toEqual({
      error: "agent_auth_required",
      message: "Valid agent credentials are required.",
    });
    expect(unicode.headers.get("www-authenticate")).toBe(
      'Bearer realm="field-guide-console"',
    );
  });

});
