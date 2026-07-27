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
    expect(catalog.entries.map(({ id }) => id)).toEqual([
      "tools-directory",
      "artifact-publisher",
      "field-guide-console",
      "network-console"
    ]);
    expect(catalog.entries.some(({ id }) => id === "tools-checker")).toBe(false);

    const projected = projectPublicSnapshot(
      catalog,
      {
        schemaVersion: CHECKER_STATE_SCHEMA_VERSION,
        revision: "empty",
        updatedAt: "2026-07-27T00:00:00.000Z",
        lastRunId: null,
        monitors: {},
        incidents: [],
        notifications: []
      },
      "2026-07-27T00:00:00.000Z"
    );
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("privateNotes");
    expect(serialized).not.toContain("stable deployment URL");
    expect(serialized).not.toContain("uploads.mauroner.eu is");
    expect(projected.statuses["network-console"]?.status).toBe("unavailable");
  });
});
