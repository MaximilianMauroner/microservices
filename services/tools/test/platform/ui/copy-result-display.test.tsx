// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CopyField } from "../../../app/routes/connect.js";
import { RecentArtifacts } from "../../../products/publisher/ui/publish-page.js";

let host: HTMLDivElement;
let root: Root;

function clipboard(...outcomes: Array<"ok" | "deny">) {
  const writeText = vi.fn();
  for (const outcome of outcomes) writeText.mockImplementationOnce(() => (outcome === "ok" ? Promise.resolve() : Promise.reject(new Error("denied"))));
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

const click = (label: string) => act(async () => {
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("Connect: a failed copy replaces the earlier Copied state", async () => {
  clipboard("ok", "deny");
  await act(async () => root.render(<CopyField label="MCP address" value="https://example.test/mcp" />));
  await click("Copy mcp address");
  expect(host.querySelector('button[aria-label="Copied"]')).not.toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await click("Copied");
  expect(host.querySelector('button[aria-label="Copied"]')).toBeNull();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
});

it("Publisher Recent: a failed copy clears the earlier check mark", async () => {
  const uploads = [{ id: "u1", kind: "file", filename: "a.txt", contentType: "text/plain", category: "document", url: "https://example.test/a", bytes: 1, updatedAt: "2026-01-01T00:00:00Z" }];
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ uploads }), { status: 200, headers: { "content-type": "application/json" } })));
  clipboard("ok", "deny");
  await act(async () => root.render(<RecentArtifacts refreshKey={0} />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  const check = () => host.querySelector('button[aria-label="Copy link for a.txt"] svg.lucide-check');
  await click("Copy link for a.txt");
  expect(check()).not.toBeNull();
  await click("Copy link for a.txt");
  expect(check()).toBeNull();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
