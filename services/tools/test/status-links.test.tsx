// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { PublicSnapshotDocument } from "@tools-platform/domain";
import { ToolsStatus } from "../status/ui/tools-status.js";

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

describe("Status navigation links", () => {
  it("renders internal, external and Open Tools links without native-button errors", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    try {
      await act(async () => { root.render(<ToolsStatus snapshot={snapshot} publicOrigin="https://tools.example.test" />); });
      expect(container.querySelector('a[href="/publisher"]')).not.toBeNull();
      expect(container.querySelector('a[href="https://external.example.test/"]')?.getAttribute("target")).toBe("_blank");
      expect(container.querySelector('a[href="/"]')?.textContent).toContain("Open Tools");
      expect(error.mock.calls).toEqual([]);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      error.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
