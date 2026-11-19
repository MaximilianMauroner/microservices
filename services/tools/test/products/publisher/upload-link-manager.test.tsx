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
  const fetchMock = vi.fn((_path: string, options?: RequestInit) => options?.method === "POST"
    ? Promise.resolve(Response.json({ ...link, url: "https://example.test/upload/new" }))
    : Promise.reject(new Error("Network failed")));
  vi.stubGlobal("fetch", fetchMock);
  Element.prototype.scrollIntoView = vi.fn();
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<UploadLinkManager />));
    expect(host.textContent).toContain("Network failed");
    expect(host.textContent).not.toContain("No upload links yet");
    const create = [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Create link")!;
    expect(create.disabled).toBe(false);
    await act(async () => create.click());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/upload-links?durationMs="), expect.objectContaining({ method: "POST" }));
    expect(host.textContent).toContain("https://example.test/upload/new");
    expect(host.textContent).toContain("Network failed");
  } finally { await act(async () => root.unmount()); host.remove(); delete (Element.prototype as Partial<Element>).scrollIntoView; }
});

it("scrolls each newly created link into view after it appears", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
  let count = 0;
  vi.stubGlobal("fetch", vi.fn((_path: string, options?: RequestInit) => Promise.resolve(options?.method === "POST"
    ? Response.json({ ...link, id: String(++count), url: `https://example.test/upload/${count}` })
    : Response.json({ links: [] }))));
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<UploadLinkManager />));
    const create = [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Create link")!;
    for (let i = 1; i <= 2; i++) {
      await act(async () => {
        create.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        frame?.(0);
      });
      expect(host.textContent).toContain(`https://example.test/upload/${i}`);
      expect(scroll).toHaveBeenCalledTimes(i);
    }
  } finally { await act(async () => root.unmount()); host.remove(); delete (Element.prototype as Partial<Element>).scrollIntoView; }
});
