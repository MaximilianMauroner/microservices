import { describe, expect, it } from "vitest";
import catalogSource from "../../dashboard/config/initial-catalog.json" with { type: "json" };
import { products } from "../../dashboard/products.js";
import { assertMonitorIdentities, loadMonitorDefinitions } from "../src/definitions.js";

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

  it("uses the same stable IDs in definitions, catalog entries, and products", () => {
    const definitions = loadMonitorDefinitions({
      PUBLIC_ORIGIN: "https://tools.example",
      MARKDOWN_SHARE_PUBLIC_ORIGIN: "https://markdown.example"
    });
    expect(() => assertMonitorIdentities(
      catalogSource.entries.map(({ id }) => id),
      products.flatMap(({ monitorId }) => monitorId ? [monitorId] : []),
      definitions
    )).not.toThrow();
    expect(definitions.find(({ id }) => id === "tower")).toMatchObject({
      staleAfterMs: 40 * 60_000
    });
    expect(() => assertMonitorIdentities(["known"], ["missing"], [
      { id: "known", kind: "http", url: "https://known.example", scope: "public", expectedStatus: [200], timeoutMs: 1000 }
    ])).toThrow(/unknownProducts=missing/);
  });
});
