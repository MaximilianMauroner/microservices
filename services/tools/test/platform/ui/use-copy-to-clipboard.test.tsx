// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCopyToClipboard } from "../../../platform/ui/lib/use-copy-to-clipboard.js";

let host: HTMLDivElement;
let root: Root;
let copyFn: ReturnType<typeof useCopyToClipboard>["copy"];

function Probe() {
  const { copy, copied, failed } = useCopyToClipboard(1000);
  copyFn = copy;
  return <p data-a={copied("a")} data-b={copied("b")} data-failed={failed} />;
}

const read = () => ({ a: host.firstElementChild!.getAttribute("data-a"), b: host.firstElementChild!.getAttribute("data-b"), failed: host.firstElementChild!.getAttribute("data-failed") });

function clipboard(...outcomes: Array<"ok" | "deny">) {
  const writeText = vi.fn();
  for (const outcome of outcomes) writeText.mockImplementationOnce(() => (outcome === "ok" ? Promise.resolve() : Promise.reject(new Error("denied"))));
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Probe />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps the newest result when an earlier write settles late", async () => {
  let finishFirst!: () => void;
  const writeText = vi.fn()
    .mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }))
    .mockImplementationOnce(() => Promise.reject(new Error("denied")));
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  let first!: Promise<void>;
  await act(async () => { first = copyFn("x", "a"); });
  await act(async () => copyFn("x", "a"));
  expect(read()).toMatchObject({ a: "false", failed: "true" });
  await act(async () => { finishFirst(); await first; });
  expect(read()).toMatchObject({ a: "false", failed: "true" });
});

it("marks only the copied key and clears it after the reset delay", async () => {
  clipboard("ok", "ok");
  await act(async () => copyFn("x", "a"));
  expect(read()).toMatchObject({ a: "true", b: "false" });
  await act(async () => vi.advanceTimersByTime(600));
  await act(async () => copyFn("y", "b"));
  expect(read()).toMatchObject({ a: "false", b: "true" });
  await act(async () => vi.advanceTimersByTime(600));
  expect(read().b).toBe("true");
  await act(async () => vi.advanceTimersByTime(500));
  expect(read()).toMatchObject({ a: "false", b: "false", failed: "false" });
});
