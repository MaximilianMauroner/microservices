import { beforeAll, describe, expect, it } from "vitest";
import { VerificationBlocked } from "./receipt.ts";

let origin: string;
let uploadToken: string;

beforeAll(() => {
  const value = process.env.TOOLS_JOURNEY_ORIGIN;
  if (!value || !process.env.TOOLS_JOURNEY_FIXTURE?.startsWith("tools-local-")) {
    throw new VerificationBlocked("The runtime runner must supply its owned built Tools stack.");
  }
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.origin !== value) {
    throw new Error("Journeys require the owned HTTP loopback origin.");
  }
  origin = url.origin;
  uploadToken = process.env.TOOLS_JOURNEY_UPLOAD_TOKEN ?? "";
  if (!uploadToken) throw new VerificationBlocked("The owned stack did not supply its native upload token.");
});

async function request(path: string, options: RequestInit = {}) {
  return fetch(new URL(path, origin), { ...options, redirect: "manual", signal: AbortSignal.timeout(10_000) });
}

describe("built Tools journeys", () => {
  it("anonymous-private-document", async () => {
    const response = await request("/status", { headers: { Accept: "text/html" } });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!, origin);
    expect(location.origin).toBe(origin);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("returnTo")).toBe("/status");
    expect(response.headers.get("cache-control")).toContain("no-store");
    await response.text();
  });

  it("anonymous-upload-link-post", async () => {
    for (const headers of [{}, { Authorization: `Bearer ${uploadToken}` }]) {
      const response = await request("/api/upload-links?durationMs=86400000", {
        method: "POST", headers: { Origin: origin, ...headers },
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "authentication_required" });
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
  });

  it("machine-token-boundary", async () => {
    for (const token of [undefined, "invalid-journey-token", uploadToken]) {
      const response = await request("/api/uploads/sessions", {
        method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: "{}",
      });
      expect(response.status).toBe(token === uploadToken ? 400 : 401);
      if (token === uploadToken) expect(await response.json()).toMatchObject({ error: "invalid_upload" });
      else await response.text();
    }
  });

  it("public-capability-denial", async () => {
    const missing = "m".repeat(43);
    const page = await request(`/drop/${missing}`);
    expect(page.status).toBe(404);
    expect(page.headers.get("location")).toBeNull();
    expect(await page.text()).toContain("This upload link is unavailable.");
    const upload = await request(`/api/drop/${missing}/uploads/sessions`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}",
    });
    expect(upload.status).toBe(404);
    expect(await upload.json()).toMatchObject({ error: "upload_link_unavailable" });
  });

  it("private-google-oauth-upload-link", () => {
    throw new VerificationBlocked("Real local Google OAuth browser login and allowed subject are absent from the owned stack. Do not mint a session. A 201 JSON response and usable guest URL still need browser acceptance.");
  });

  it("authenticated-cross-origin-denial", () => {
    throw new VerificationBlocked("A real local Google OAuth session is required to prove cross-origin denial without a state change. Anonymous 401 does not prove this boundary.");
  });

  it("historical-pre-middleware-upload-link", () => {
    throw new VerificationBlocked("The pre-middleware revision 98f7ca5^ and corrected revision 98f7ca5 need separately owned built stacks and real local Google OAuth sessions. Handler or source replay cannot prove their HTTP behavior.");
  });

  it("heartbeat-publication", () => {
    throw new VerificationBlocked("No bounded checker fixture with explicit local monitors, canonical pause state, and notifications disabled exists. Default monitor targets are refused. HTTP 204 proves no publication.");
  });
});
