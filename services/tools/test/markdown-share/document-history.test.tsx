// @vitest-environment jsdom


import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDiffRows, useDocumentHistory } from "../../markdown-share/document-history.js";

const mocks = vi.hoisted(() => ({
  saveCheckpoint: vi.fn(async () => null),
  comparisonArgs: [] as unknown[],
}));

const checkpoints = [
  {
    _id: "checkpoint-newer",
    createdAt: 2_000,
    createdBy: "Blue Finch",
    charCount: 5,
    version: 2,
  },
  {
    _id: "checkpoint-older",
    createdAt: 1_000,
    createdBy: "Blue Finch",
    charCount: 3,
    version: 1,
  },
];

vi.mock("../../markdown-share/transport.js", () => ({ documentRequest: async (token: string, path: string) => {
  if (path === "/checkpoints") return mocks.saveCheckpoint();
  mocks.comparisonArgs.push(path);
  return {
    older: { ...checkpoints[1], markdown: "old" },
    newer: { ...checkpoints[0], markdown: "newer" },
  };
} }));

function HistoryHarness({ canCreateCheckpoint }: { canCreateCheckpoint: boolean }) {
  const history = useDocumentHistory({
    token: "abcdefghijklmnopqrst",
    createdBy: "Blue Finch",
    canCreateCheckpoint,
    checkpoints,
    onCheckpoint: () => {},
  });
  return (
    <main>
      {history.renderControl("desktop")}
      {history.dialog}
    </main>
  );
}

function button(label: string): HTMLButtonElement {
  const match = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!match) {
    throw new Error(`Missing button: ${label}`);
  }
  return match;
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  mocks.saveCheckpoint.mockClear();
  mocks.comparisonArgs.length = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("document history", () => {
  it("builds line-numbered checkpoint diff rows", () => {
    expect(buildDiffRows("one\ntwo\n", "one\nthree\n")).toEqual([
      { kind: "unchanged", value: "one", oldLine: 1, newLine: 1 },
      { kind: "removed", value: "two", oldLine: 2, newLine: null },
      { kind: "added", value: "three", oldLine: null, newLine: 2 },
    ]);
  });

  it("keeps checkpoint creation disabled when the session is unavailable", () => {
    act(() => root.render(<HistoryHarness canCreateCheckpoint={false} />));
    act(() => button("History · 2").click());

    expect(button("Save as checkpoint").disabled).toBe(true);
  });

  it("owns comparison defaults and renders the selected diff", async () => {
    act(() => root.render(<HistoryHarness canCreateCheckpoint />));
    act(() => button("History · 2").click());
    await act(async () => button("Compare checkpoints").click());

    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.textContent).toContain("Compare checkpoints");
    expect(host.textContent).toContain("+1 lines");
    expect(mocks.comparisonArgs).toContain("/checkpoints/compare?olderId=checkpoint-older&newerId=checkpoint-newer");
  });
});
