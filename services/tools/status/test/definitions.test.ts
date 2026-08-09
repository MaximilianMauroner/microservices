import { describe, expect, it } from "vitest";
import { loadMonitorDefinitions } from "../src/definitions.js";

describe("monitor definitions", () => {
  it("owns HTTP and heartbeat check behavior in typed code", () => {
    const definitions = loadMonitorDefinitions({
      PUBLIC_ORIGIN: "https://tools.example/ignored",
      MARKDOWN_SHARE_PUBLIC_ORIGIN: "https://markdown.example/path",
      TOWER_HEARTBEAT_STALE_AFTER_MS: "240000"
    });
    expect(definitions.find(({ id }) => id === "markdown-share")).toMatchObject({
      kind: "http",
      url: "https://markdown.example"
    });
    expect(definitions.find(({ id }) => id === "tower")).toEqual({
      id: "tower",
      kind: "heartbeat",
      scope: "public",
      checkUrl: "https://tools.example/health/tower",
      staleAfterMs: 240_000
    });
  });
});
