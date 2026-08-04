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
});
