import { describe, expect, it } from "vitest";
import { clientAddress, createRateLimit } from "../../../platform/security/rate-limit.js";

describe("rate limit", () => {
  it("allows the limit in one window, refuses the next request, and allows again after the window", () => {
    const allow = createRateLimit({ limit: 2, windowMs: 1000 });
    expect([allow("a", 0), allow("a", 10), allow("a", 20)]).toEqual([true, true, false]);
    expect(allow("b", 20), "another client has its own count").toBe(true);
    expect(allow("a", 1000)).toBe(true);
  });

  it("keeps counting new clients after it tracks the most keys", () => {
    const allow = createRateLimit({ limit: 1, windowMs: 60_000 });
    for (let i = 0; i < 10_050; i++) allow(`client-${i}`, 0);
    expect(allow("client-10049", 1)).toBe(false);
    expect(allow("new-client", 1)).toBe(true);
  });

  it("reads the client address that Cloudflare sets", () => {
    expect(clientAddress(new Request("https://tools.example.test/", { headers: { "cf-connecting-ip": "203.0.113.7" } }))).toBe("203.0.113.7");
    expect(clientAddress(new Request("https://tools.example.test/"))).toBe("unknown");
  });
});
