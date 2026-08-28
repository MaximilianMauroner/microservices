// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getScrollProgress,
  getScrollTop,
  useWorkspaceViewport,
} from "./workspace-viewport.js";

let root: Root;
let host: HTMLDivElement;
let nextFrameId: number;
let frames: Map<number, FrameRequestCallback>;

function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) {
    callback(0);
  }
}

function ViewportHarness() {
  const viewport = useWorkspaceViewport();
  return (
    <>
      <button onClick={() => viewport.setMobilePane("preview")}>Preview</button>
      <div
        data-testid="source"
        ref={viewport.sourceScrollRef}
        onScroll={() => viewport.handlePaneScroll("source")}
      />
      <article
        data-testid="preview"
        ref={viewport.previewScrollRef}
        onScroll={() => viewport.handlePaneScroll("preview")}
      />
    </>
  );
}

beforeEach(() => {
  nextFrameId = 1;
  frames = new Map();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
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

describe("workspace viewport", () => {
  it("maps pane heights through a bounded scroll progress", () => {
    expect(getScrollProgress(450, 1_000, 100)).toBe(0.5);
    expect(getScrollTop(0.5, 2_000, 200)).toBe(900);
    expect(getScrollProgress(30, 100, 100)).toBe(0);
    expect(getScrollTop(2, 500, 100)).toBe(400);
  });

  it("keeps source and preview at the same proportional position", () => {
    act(() => root.render(<ViewportHarness />));
    flushFrames();

    const source = host.querySelector<HTMLElement>('[data-testid="source"]')!;
    const preview = host.querySelector<HTMLElement>('[data-testid="preview"]')!;
    Object.defineProperties(source, {
      clientHeight: { value: 100 },
      scrollHeight: { value: 1_000 },
    });
    Object.defineProperties(preview, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 2_000 },
    });
    source.scrollTop = 450;

    act(() => source.dispatchEvent(new Event("scroll", { bubbles: true })));
    flushFrames();
    expect(preview.scrollTop).toBe(900);

    act(() => host.querySelector("button")!.click());
    flushFrames();
    expect(preview.scrollTop).toBe(900);
  });

  it("removes browser state and scheduled frames when unmounted", () => {
    act(() => root.render(<ViewportHarness />));
    expect(document.documentElement.style.getPropertyValue("--app-height")).not.toBe("");
    expect(frames.size).toBeGreaterThan(0);

    act(() => root.unmount());
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("");
    expect(frames.size).toBe(0);
    root = createRoot(host);
  });
});
