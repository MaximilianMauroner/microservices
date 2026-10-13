// @vitest-environment jsdom
import crypto from "node:crypto";
import { File as LocalFile } from "node:buffer";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PublishPage } from "../publisher/ui/publish-page.js";

it.each(["retry", "reselect"] as const)("resumes an empty-MIME HTML file through the page after %s", async (resume) => {
  const saved = new Map<string, string>();
  const sessions = new Map<string, Set<number>>();
  const initialized: Array<{ requestId: string; kind?: string; contentType?: string }> = [];
  const puts: Array<{ number: number; bytes: Blob }> = [];
  let completions = 0;
  let interrupted = true;
  let now = 1000;
  // File's unspecified timestamp changes for every wrapper, as it can between
  // retries in a browser. An explicit source timestamp must survive that wrap.
  class BrowserFile extends LocalFile {
    constructor(...[bits, name, options]: ConstructorParameters<typeof LocalFile>) {
      super(bits, name, { lastModified: now++, ...options });
    }
  }
  class TransferXhr extends EventTarget {
    upload = new EventTarget();
    status = 200;
    timeout = 0;
    withCredentials = false;
    url = "";
    open(_method: string, url: string) { this.url = url; }
    send(bytes: Blob) {
      const [id, part] = new URL(this.url).pathname.slice(1).split("/");
      const number = Number(part);
      puts.push({ number, bytes });
      queueMicrotask(() => {
        const failed = interrupted && number === 2;
        if (!failed) sessions.get(id!)!.add(number);
        this.dispatchEvent(new Event(failed ? "error" : "load"));
        this.dispatchEvent(new Event("loadend"));
      });
    }
  }
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("File", BrowserFile);
  vi.stubGlobal("crypto", crypto.webcrypto);
  vi.stubGlobal("XMLHttpRequest", TransferXhr);
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === "/health/publisher") return Response.json({ ok: true });
    if (url.startsWith("/api/external-uploads?")) return Response.json({ uploads: [] });
    if (url.endsWith("/complete")) {
      completions += 1;
      return Response.json({ id: "a".repeat(32), kind: "html", filename: "fixture.htm", contentType: "text/html",
        bytes: 6, url: "https://tools.example.test/artifacts/fixture", updatedAt: "2026-10-13T12:00:00Z" }, { status: 201 });
    }
    const body: { requestId: string; number?: number; kind?: string; contentType?: string } = JSON.parse(String(init.body));
    if (url.endsWith("/parts")) {
      const id = url.split("/").at(-2);
      return Response.json({ url: `https://bucket.example/${id}/${body.number}` });
    }
    initialized.push(body);
    if (!sessions.has(body.requestId)) sessions.set(body.requestId, new Set());
    return Response.json({ sessionId: body.requestId, partBytes: 4, totalParts: 2, state: "uploading", uploaded: [...sessions.get(body.requestId)!] });
  }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const choose = (file: LocalFile) => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  try {
    await act(async () => root.render(<PublishPage />));
    await act(async () => {
      choose(new BrowserFile(["abcdef"], "fixture.htm", { lastModified: 123 }));
      await vi.waitFor(() => expect(puts).toHaveLength(3));
    });
    expect(host.textContent).toContain("Upload failed");
    expect(saved.size).toBe(1);
    expect(initialized[0]).toMatchObject({ kind: "html", contentType: "text/html" });
    puts.length = 0;
    interrupted = false;
    await act(async () => {
      if (resume === "retry") {
        const retry = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === "Retry failed (1)");
        expect(retry).toBeDefined();
        retry!.click();
      } else {
        choose(new BrowserFile(["abcdef"], "fixture.htm", { lastModified: 123 }));
      }
      await vi.waitFor(() => expect(completions).toBe(1));
    });
    expect(initialized).toHaveLength(2);
    expect(initialized[1]?.requestId).toBe(initialized[0]?.requestId);
    expect(sessions.size).toBe(1);
    expect(puts.map(part => part.number)).toEqual([2]);
    expect(await puts[0]!.bytes.text()).toBe("ef");
    expect(host.textContent).toContain("File is ready to share");
    expect(saved.size).toBe(0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
