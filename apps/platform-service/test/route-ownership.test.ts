import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readOnly } from "../src/route-handlers.js";

describe("primary page ownership", () => {
  it("registers explicit React routes without legacy browser splats", () => {
    const source = readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");
    for (const path of ["/status", "/review", "/publish", "/manage", "/manage/status", "/manage/documents", "/tools/private/money"]) {
      expect(source).toContain(`fullPath: '${path}'`);
    }
    for (const path of ["/review/$", "/publish/$", "/manage/$", "/ops", "/uploads", "/p", "/f", "/status/private"]) {
      expect(source).not.toContain(`fullPath: '${path}'`);
    }
  });

  it("uses preloaded client navigation for review links", () => {
    const source = readFileSync(new URL("../src/features/review/review-page.tsx", import.meta.url), "utf8");
    const reviewLinks = [...source.matchAll(/<Link to="\/review"[^>]*>/g)].map(([link]) => link);
    expect(reviewLinks.length).toBeGreaterThan(0);
    expect(reviewLinks.every((link) => link.includes('preload="intent"'))).toBe(true);
    expect(reviewLinks.every((link) => !link.includes("reloadDocument"))).toBe(true);
    expect(source).toContain("window.location.replace(`/review?${params}`)");
    expect(source).not.toContain("useNavigate");
  });

  it("waits for matching loader data when switching review views", () => {
    const source = readFileSync(new URL("../src/features/review/review-page.tsx", import.meta.url), "utf8");

    expect(source).toContain('search.view === "decisions" && data.view === "decisions" && data.decisions');
    expect(source).toContain('search.view === "queue" && data.view === "queue" && data.queue');
    expect(source).toContain('search.view === "history" && data.view === "history" && data.history');
    expect(source).not.toContain("queue: data.queue!");
  });

  it("keeps catalog management read-only at both UI and API boundaries", () => {
    const page = readFileSync(new URL("../src/features/manage/manage-page.tsx", import.meta.url), "utf8");
    const route = readFileSync(new URL("../src/routes/api/ops/$.ts", import.meta.url), "utf8");

    for (const mutation of ["Save group", "Save entry", "Delete", "Add group", "Add entry", "method: \"POST\"", "method: \"PATCH\""]) {
      expect(page).not.toContain(mutation);
    }
    expect(route).toContain("handlers: { GET: tools, HEAD: tools, POST: readOnly, PUT: readOnly, PATCH: readOnly, DELETE: readOnly }");
    expect(route).not.toMatch(/\b(POST|PUT|PATCH|DELETE): tools/);
  });

  it("protects private money data with the shared session middleware", () => {
    const source = readFileSync(new URL("../src/protected-data.ts", import.meta.url), "utf8");
    const moneyLoader = source.slice(source.indexOf("getMoneyTrackerPageData"), source.indexOf("getPrivateStatusPageData"));
    expect(moneyLoader).toContain(".middleware([requirePlatformSession])");
  });

  it("rejects catalog mutations with an explicit read-only response", async () => {
    const response = readOnly();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    await expect(response.json()).resolves.toEqual({ error: "read_only" });
  });
});
