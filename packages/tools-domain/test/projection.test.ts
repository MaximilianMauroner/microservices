import { describe, expect, it } from "vitest";
import {
  projectPrivateSnapshot,
  projectPublicSnapshot
} from "../src/index.js";
import { NOW, catalogFixture, stateFixture } from "./fixtures.js";

describe("snapshot projection", () => {
  it("strictly redacts private entries, links, notes, and monitor settings", () => {
    const catalog = catalogFixture();
    catalog.entries[2].visibility = "public";
    const snapshot = projectPublicSnapshot(
      catalog,
      stateFixture(),
      NOW
    );
    expect(snapshot.groups.map(({ id }) => id)).toEqual(["operations"]);
    expect(snapshot.entries.map(({ id }) => id)).toEqual([
      "public-tool",
      "tailnet-tool"
    ]);
    expect(snapshot.entries[0].links.map(({ access }) => access)).toEqual([
      "public",
      "restricted"
    ]);

    const serialized = JSON.stringify(snapshot);
    for (const forbidden of [
      "never publish",
      "classified",
      "private-tool",
      "private-link",
      "health.example",
      "lastRunId",
      "notifications",
      "incidents"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("projects safe status and marks Tailscale-only monitors unavailable", () => {
    const snapshot = projectPublicSnapshot(
      catalogFixture(),
      stateFixture(),
      NOW
    );
    expect(snapshot.statuses["public-tool"]).toEqual({
      monitorId: "public-tool",
      status: "up",
      checkedAt: NOW,
      latencyMs: 42,
      statusCode: 200
    });
    expect(snapshot.statuses["tailnet-tool"]).toEqual({
      monitorId: "tailnet-tool",
      status: "unavailable",
      checkedAt: null,
      latencyMs: null,
      statusCode: null
    });
  });

  it("retains full admin state only in the private snapshot", () => {
    const snapshot = projectPrivateSnapshot(
      catalogFixture(),
      stateFixture(),
      NOW
    );
    expect(snapshot.catalog.entries[0].privateNotes).toBe("never publish");
    expect(snapshot.state.lastRunId).toBe("run-1");
  });
});
