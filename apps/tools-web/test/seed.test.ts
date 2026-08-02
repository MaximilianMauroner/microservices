import { readFile } from "node:fs/promises";
import {
  CHECKER_STATE_SCHEMA_VERSION,
  decodeCatalogDocument,
  projectPublicSnapshot
} from "@tools-platform/domain";
import { describe, expect, it } from "vitest";

describe("initial catalog", () => {
  it("is schema-valid, names only qualifying services, and projects safely", async () => {
    const input: unknown = JSON.parse(
      await readFile(
        new URL("../config/initial-catalog.json", import.meta.url),
        "utf8"
      )
    );
    const catalog = decodeCatalogDocument(input);
    expect(
      [...catalog.groups]
        .sort((left, right) => left.order - right.order)
        .map(({ id, name }) => ({ id, name }))
    ).toEqual([
      { id: "publishing", name: "Publishing & sharing" },
      { id: "review", name: "Review & feedback" },
      { id: "operations", name: "Operations" },
      { id: "private-infrastructure", name: "Private infrastructure" }
    ]);
    expect(catalog.entries.map(({ id }) => id).sort()).toEqual([
      "artifact-publisher",
      "field-guide-console",
      "home-assistant",
      "markdown-share",
      "network-console",
      "tools-directory",
      "tower"
    ]);
    expect(catalog.entries).toHaveLength(7);
    expect(catalog.entries.some(({ id }) => id === "tools-checker")).toBe(false);
    expect(
      Object.fromEntries(
        catalog.entries.map(({ id, monitor }) => [id, monitor?.url]),
      ),
    ).toMatchObject({
      "artifact-publisher": "https://tools.mauroner.net/health/publisher",
      "field-guide-console": "https://tools.mauroner.net/health/review",
      "markdown-share": "https://markdown-share-alpha.mauroner.workers.dev/",
      "home-assistant": "https://homeassistant.mauroner.net/",
      tower: "https://tools.mauroner.net/health/tower",
      "tools-directory": "https://tools.mauroner.net/health/tools",
    });
    expect(
      catalog.entries.find(({ id }) => id === "artifact-publisher")?.monitor
        ?.paused
    ).toBe(false);

    const projected = projectPublicSnapshot(
      catalog,
      {
        schemaVersion: CHECKER_STATE_SCHEMA_VERSION,
        revision: "empty",
        updatedAt: "2026-07-27T00:00:00.000Z",
        lastRunId: null,
        monitors: {},
        incidents: [],
        notifications: [],
        historyPending: []
      },
      "2026-07-27T00:00:00.000Z"
    );
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("privateNotes");
    expect(serialized).not.toContain("stable deployment URL");
    expect(serialized).not.toContain("uploads.mauroner.eu is");
    expect(serialized).not.toContain("Home Assistant");
    expect(serialized).not.toContain("tower.tailbc92d.ts.net");
    expect(projected.statuses["network-console"]?.status).toBe("unavailable");
  });
});
