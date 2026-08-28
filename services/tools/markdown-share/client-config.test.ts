import { describe, expect, it } from "vitest";
import { loadMarkdownShareClientConfig } from "./client-config.js";

describe("Markdown Share browser configuration", () => {
  it("derives the exact Convex HTTP and WebSocket origins", () => {
    expect(loadMarkdownShareClientConfig("https://example.convex.cloud")).toEqual({
      convexUrl: "https://example.convex.cloud",
      connectOrigins: ["https://example.convex.cloud", "wss://example.convex.cloud"],
    });
    expect(loadMarkdownShareClientConfig("http://127.0.0.1:3210").connectOrigins).toEqual([
      "http://127.0.0.1:3210",
      "ws://127.0.0.1:3210",
    ]);
  });

  it.each([undefined, "", "not a url", "http://example.convex.cloud", "https://example.convex.cloud/path"])("rejects %s", (value) => {
    expect(() => loadMarkdownShareClientConfig(value)).toThrow();
  });
});
