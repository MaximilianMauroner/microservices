import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("primary page ownership", () => {
  it("registers explicit React routes without legacy browser splats", () => {
    const source = readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");
    for (const path of ["/status", "/review", "/publish", "/manage", "/manage/status", "/manage/documents"]) {
      expect(source).toContain(`fullPath: '${path}'`);
    }
    expect(source).not.toContain("fullPath: '/review/$'");
    expect(source).not.toContain("fullPath: '/publish/$'");
    expect(source).not.toContain("fullPath: '/manage/$'");
  });

  it("uses document navigation for Cloudflare Access-protected review links", () => {
    const source = readFileSync(new URL("../src/components/review-page.tsx", import.meta.url), "utf8");
    const reviewLinks = [...source.matchAll(/<Link to="\/review"[^>]*>/g)].map(([link]) => link);
    expect(reviewLinks.length).toBeGreaterThan(0);
    expect(reviewLinks.every((link) => link.includes("reloadDocument"))).toBe(true);
  });
});
