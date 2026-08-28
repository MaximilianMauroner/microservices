import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Tools server startup configuration", () => {
  it("loads Markdown Share validation from the server entry", () => {
    const source = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");

    expect(source).toContain('import "./markdown-share-config.server.js";');
  });

  it("rejects a missing Convex origin when the server configuration loads", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "");

    await expect(import("../src/markdown-share-config.server.js")).rejects.toThrow(
      "Missing required environment variable: VITE_CONVEX_URL"
    );
  });

  it("rejects an invalid Convex origin when the server configuration loads", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "not a URL");

    await expect(import("../src/markdown-share-config.server.js")).rejects.toThrow(
      "VITE_CONVEX_URL must be a valid Convex HTTP(S) origin"
    );
  });
});
