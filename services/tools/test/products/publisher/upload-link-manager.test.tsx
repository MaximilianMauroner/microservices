// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { UploadLinkManager } from "../../../products/publisher/ui/upload-link-manager.js";

const link = { id: "one", createdAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-02T00:00:00Z", fileCount: 1 };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("waits for the list and asks before revoking an expired link", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let finish!: (response: Response) => void;
  const fetchMock = vi.fn((_path: string, options?: RequestInit) => options?.method === "DELETE" ? Promise.resolve(new Response(null, { status: 204 })) : new Promise<Response>((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === text)!;
  try {
    await act(async () => root.render(<UploadLinkManager />));
    expect(host.textContent).toContain("Loading upload links");
    expect(host.textContent).not.toContain("No upload links yet");
    expect(button("Create link").disabled).toBe(true);
    await act(async () => finish(Response.json({ links: [link] })));
    await act(async () => button("Revoke…").click());
    expect(document.body.textContent).toContain("Revoke this upload link?");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => button("Cancel").click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => button("Revoke…").click());
    await act(async () => button("Revoke link").click());
    expect(fetchMock).toHaveBeenCalledWith("/api/upload-links/one", expect.objectContaining({ method: "DELETE" }));
    expect(host.textContent).toContain("Revoked");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("does not present an empty list when loading fails", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network failed")));
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<UploadLinkManager />));
    expect(host.textContent).toContain("Network failed");
    expect(host.textContent).not.toContain("No upload links yet");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
