import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readOnly } from "../src/route-handlers.js";

describe("primary page ownership", () => {
  it("registers explicit React routes without legacy browser splats", () => {
    const source = readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");
    for (const path of ["/status", "/publisher", "/publisher/artifacts", "/documents", "/money", "/feedback", "/feedback/forms/$formId", "/feedback/responses/$submissionId", "/feedback/f/$token", "/markdown/", "/markdown/d/$slug", "/drop/$", "/api/drop/$", "/api/upload-links", "/api/upload-links/$"]) {
      expect(source).toContain(`fullPath: '${path}'`);
    }
    for (const path of ["/review", "/publish", "/manage", "/manage/status", "/manage/documents", "/tools/private/money", "/ops", "/uploads", "/p", "/f", "/status/private"]) {
      expect(source).not.toContain(`fullPath: '${path}'`);
    }
  });

  it("periodically reloads an open status page", () => {
    const source = readFileSync(new URL("../src/routes/status.tsx", import.meta.url), "utf8");

    expect(source).toContain("window.setInterval");
    expect(source).toContain("void router.invalidate()");
    expect(source).toContain("window.clearInterval(interval)");
  });

  it("keeps catalog operations read-only while Manage uses publisher lifecycle routes", () => {
    const page = readFileSync(new URL("../publisher/ui/manage-page.tsx", import.meta.url), "utf8");
    const route = readFileSync(new URL("../src/routes/api/ops/$.ts", import.meta.url), "utf8");

    expect(page).toContain("/api/external-uploads/${selected.id}");
    expect(page).not.toContain("/api/ops/catalog");
    expect(route).toContain("handlers: { GET: tools, HEAD: tools, POST: readOnly, PUT: readOnly, PATCH: readOnly, DELETE: readOnly }");
    expect(route).not.toMatch(/\b(POST|PUT|PATCH|DELETE): tools/);
  });

  it("keeps upload-link revocation available independently of the browser clock", () => {
    const source = readFileSync(new URL("../publisher/ui/upload-link-manager.tsx", import.meta.url), "utf8");
    expect(source).toContain("!link.revokedAt ? <Button");
    expect(source).not.toContain("active ? <Button type=\"button\"");
  });

  it("loads upload-link history in bounded pages", () => {
    const source = readFileSync(new URL("../publisher/ui/upload-link-manager.tsx", import.meta.url), "utf8");
    expect(source).toContain("setNextCursor(payload.nextCursor)");
    expect(source).toContain("/api/upload-links?cursor=");
    expect(source).toContain("Load older links");
  });

  it("protects private money data with the shared session middleware", () => {
    const source = readFileSync(new URL("../src/protected-data.ts", import.meta.url), "utf8");
    const moneyLoader = source.slice(source.indexOf("getMoneyTrackerPageData"), source.indexOf("getPrivateStatusPageData"));
    expect(moneyLoader).toContain(".middleware([requirePlatformSession])");
  });

  it("keeps the public feedback form outside the private feedback route guards", () => {
    const layout = readFileSync(new URL("../src/routes/feedback.tsx", import.meta.url), "utf8");
    const list = readFileSync(new URL("../src/routes/feedback/index.tsx", import.meta.url), "utf8");
    const form = readFileSync(new URL("../src/routes/feedback/forms/$formId.tsx", import.meta.url), "utf8");
    const response = readFileSync(new URL("../src/routes/feedback/responses/$submissionId.tsx", import.meta.url), "utf8");
    const publicForm = readFileSync(new URL("../src/routes/feedback/f/$token.tsx", import.meta.url), "utf8");
    expect(layout).not.toContain("requireRouteSession");
    expect(publicForm).not.toContain("requireRouteSession");
    for (const source of [list, form, response]) expect(source).toContain("requireRouteSession");
  });

  it("rejects catalog mutations with an explicit read-only response", async () => {
    const response = readOnly();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    await expect(response.json()).resolves.toEqual({ error: "read_only" });
  });
});
