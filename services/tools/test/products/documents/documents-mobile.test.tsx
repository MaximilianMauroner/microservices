// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DocumentsPage } from "../../../products/dashboard/ui/documents-page.js";

vi.mock("../../../platform/ui/components/app-shell.js", () => ({ AppShell: () => null }));
vi.mock("../../../platform/ui/components/ui/use-mobile.js", () => ({ useIsMobile: () => true }));

it("offers a mobile copy action and a selectable link when clipboard access fails", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const now = Date.UTC(2026, 7, 4, 12);
  const token = "a".repeat(24);
  try {
    await act(async () => root.render(<DocumentsPage initial={{ actor: "owner", publicOrigin: "https://example.test", generatedAt: now, documents: [{ token, filename: "note.md", createdAt: now, updatedAt: now, expiresAt: now + 3600000, checkpointCount: 0 }], truncated: false }} />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Copy link for note.md"]')!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Copy failed");
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Document links"]')?.value).toBe(`https://example.test/share/d/note.md--${token}`);
    expect(container.querySelector('[aria-label="Select note.md"]')).not.toBeNull();
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
});
