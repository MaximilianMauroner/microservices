// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { PublicSnapshotDocument } from "#domain";
import { ToolsStatus } from "../../../products/status/ui/tools-status.js";

const snapshot: PublicSnapshotDocument = {
  schemaVersion: 1,
  generatedAt: "2026-10-02T12:00:00.000Z",
  catalogRevision: "synthetic",
  groups: [{ id: "tools", name: "Tools", order: 0 }],
  entries: [{
    id: "publisher", groupId: "tools", name: "Publisher", description: "Synthetic service", order: 0,
    links: [
      { id: "internal", label: "Publish", url: "https://tools.example.test/publisher", access: "restricted" },
      { id: "external", label: "External service", url: "https://external.example.test/", access: "public" }
    ]
  }],
  statuses: {}
};

describe("Status history", () => {
  it("keeps daily history out of the tab order and provides a readable list", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const status = { monitorId: "publisher", checkedAt: "2026-10-02T12:00:00.000Z", latencyMs: 1, statusCode: 200, status: "up" as const, uptimeDays: [{ day: "2026-10-02", successfulChecks: 1, totalChecks: 2 }], downtimeRecords: [] };
    try {
      await act(async () => root.render(<ToolsStatus snapshot={{ ...snapshot, statuses: { publisher: status } }} publicOrigin="https://tools.example.test" />));
      expect(container.querySelectorAll('.uptime-bar-scroll [tabindex="0"]')).toHaveLength(0);
      expect(container.querySelector(".uptime-bar-scroll")?.hasAttribute("tabindex")).toBe(false);
      expect(container.textContent).toContain("Daily uptime");
      expect(container.textContent).toContain("50% uptime · 0s recorded downtime · 2 checks");
    } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
  });

});
