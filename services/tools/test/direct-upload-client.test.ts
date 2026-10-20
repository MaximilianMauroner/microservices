import crypto from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { handleDirectUpload } from "../publisher/src/direct-upload-request.js";
import type { DirectUploads } from "../publisher/src/direct-uploads.js";
import { ManagePage } from "../publisher/ui/manage-page.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadDirectFile, type DirectUploadCallbacks } from "../publisher/ui/direct-upload.js";
import { friendlyUploadError } from "../publisher/ui/upload-errors.js";

class TransferXhr extends EventTarget {
  upload = new EventTarget();
  status = 200;
  timeout = 0;
  withCredentials = true;
  url = "";
  static puts: Array<{ url: string; bytes: Blob; credentials: boolean }> = [];
  static fail = false;
  open(_method: string, url: string) { this.url = url; }
  send(bytes: Blob) {
    TransferXhr.puts.push({ url: this.url, bytes, credentials: this.withCredentials });
    queueMicrotask(() => {
      this.dispatchEvent(new Event(TransferXhr.fail ? "error" : "load"));
      this.dispatchEvent(new Event("loadend"));
    });
  }
}

describe("durable browser upload client", () => {
  const saved = new Map<string, string>();
  const callbacks: DirectUploadCallbacks = { onProgress: vi.fn(), onProcessing: vi.fn(), registerXhr: vi.fn(), isCancelled: () => false };
  const requests: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  let uploaded: number[];
  let requestId: string;
  let completionResponsesLost: number;
  const result = { id: "a".repeat(32), filename: "fixture.bin", bytes: 6, kind: "file", contentType: "application/octet-stream", category: "other", url: "https://tools.example/files/fixture",
    sha256: crypto.createHash("sha256").update("abcdef").digest("hex"), updatedAt: "2026-10-16T12:00:00.000Z" };

  beforeEach(() => {
    saved.clear(); requests.length = 0; TransferXhr.puts = []; TransferXhr.fail = false;
    uploaded = []; requestId = ""; completionResponsesLost = 0;
    vi.stubGlobal("crypto", crypto.webcrypto);
    vi.stubGlobal("XMLHttpRequest", TransferXhr);
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const body: Record<string, unknown> | undefined = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ url, method: init.method ?? "GET", ...(body ? { body } : {}) });
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      if (url.endsWith("/complete")) {
        if (completionResponsesLost-- > 0) throw new TypeError("Connection closed after completion");
        return Response.json(result, { status: 201 });
      }
      if (url.endsWith("/parts")) return Response.json({ url: "https://bucket.example/part/" + body?.number });
      requestId = String(body?.requestId);
      return Response.json({ sessionId: requestId, partBytes: 4, totalParts: 2, state: "uploading", uploaded });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("resumes an interrupted file with its saved ID, validates skipped part digests, and keeps cookies off storage", async () => {
    const file = new File(["abcdef"], "fixture.bin", { lastModified: 123 });
    TransferXhr.fail = true;
    await expect(uploadDirectFile(file, callbacks)).rejects.toThrow("interrupted");
    const previous = requestId;
    expect(saved.size).toBe(1);
    expect(requests.some(request => request.method === "DELETE")).toBe(false);
    TransferXhr.fail = false; uploaded = [1]; TransferXhr.puts = [];
    expect(await uploadDirectFile(file, callbacks)).toMatchObject(result);
    expect(requestId).toBe(previous);
    expect(TransferXhr.puts).toHaveLength(1);
    expect(TransferXhr.puts[0]?.credentials).toBe(false);
    expect(await TransferXhr.puts[0]!.bytes.text()).toBe("ef");
    expect(requests.filter(request => request.url.endsWith("/parts")).at(-2)?.body).toMatchObject({
      number: 1, sha256: crypto.createHash("sha256").update("abcd").digest("hex") });
    expect(saved.size).toBe(0);
  });

  it.each([false, true])("renders the saved HTTP completion time in the Library for replacement %s", async replace => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T14:00:00.000Z"));
    const direct: DirectUploads = {
      create: vi.fn(), status: vi.fn(), sign: vi.fn(), abort: vi.fn(), cleanup: vi.fn(), close: vi.fn(),
      complete: vi.fn<DirectUploads["complete"]>().mockResolvedValue({
        id: result.id, kind: "html", filename: "revised.html", contentType: "text/html",
        totalBytes: 6, partBytes: 4, sha256: result.sha256, updatedAt: new Date(result.updatedAt)
      })
    };
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/complete")) return handleDirectUpload(new Request("https://tools.example" + url, init),
        url.split("/sessions/")[1]!, direct, { audience: "browser" }, {
          maxBytes: 100, maxHtmlBytes: 100, maxConcurrent: 1, retentionMs: 60_000,
          baseUrl: "https://tools.example", allowHtml: true
        });
      const response = await original(url, init);
      return replace && url.endsWith("/sessions")
        ? Response.json({ ...await response.json(), replaceId: result.id }) : response;
    }));
    const completed = await uploadDirectFile(new File(["abcdef"], "revised.html", { type: "text/html" }),
      callbacks, { kind: "html", ...(replace ? { replaceId: result.id } : {}) });
    expect(completed.updatedAt).toBe(result.updatedAt);
    const html = renderToStaticMarkup(createElement(ManagePage, { initial: { uploads: [completed] } }));
    expect(html).toContain("revised.html");
    expect(html).toContain("2h ago");
    expect(html).toContain("16 Oct 2026, 14:00 CEST");
  });

  it.each([undefined, null, 42, "", "not a date", "2026-02-30T12:00:00.000Z",
    "2026-10-16", "2026-10-16T12:00:00+02:00"])("rejects completion time %j and retains its retry ID", async updatedAt => {
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const response = await original(url, init);
      return url.endsWith("/complete") ? Response.json({ ...result, updatedAt }) : response;
    }));
    const file = new File(["abcdef"], "fixture.bin", { lastModified: 123 });
    await expect(uploadDirectFile(file, callbacks)).rejects.toThrow("Invalid upload completion response.");
    const previous = requestId;
    expect([...saved.values()]).toEqual([previous]);
    expect(requests.some(request => request.method === "DELETE")).toBe(false);
    vi.stubGlobal("fetch", original);
    expect(await uploadDirectFile(file, callbacks)).toMatchObject(result);
    expect(requestId).toBe(previous);
  });

  it("retries a completion whose response was lost with the same session", async () => {
    completionResponsesLost = 1;
    const pending = uploadDirectFile(new File(["abcdef"], "fixture.bin"), callbacks);
    expect(await pending).toMatchObject(result);
    const completions = requests.filter(request => request.url.endsWith("/complete"));
    expect(completions).toHaveLength(2);
    expect(completions[0]?.url).toBe(completions[1]?.url);
  });

  it("replaces the selected HTML page through storage without sending cookies", async () => {
    const original = globalThis.fetch;
    const replacement = { ...result, kind: "html", filename: "revised.html", contentType: "text/html",
      url: `https://tools.example/artifacts/${result.id}` };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const response = await original(url, init);
      if (url.endsWith("/sessions")) return Response.json({ ...await response.json(), replaceId: result.id });
      if (url.endsWith("/complete")) return Response.json(replacement, { status: 200 });
      return response;
    }));
    expect(await uploadDirectFile(new File(["abcdef"], "revised.html", { type: "text/html" }), callbacks,
      { kind: "html", replaceId: result.id })).toEqual(replacement);
    expect(requests[0]?.body).toMatchObject({ kind: "html", replaceId: result.id });
    expect(requests.find(request => request.url.endsWith("/complete"))?.body).toEqual({ sha256: result.sha256 });
    expect(TransferXhr.puts).toHaveLength(2);
    expect(TransferXhr.puts.every(put => !put.credentials)).toBe(true);
  });

  it.each([undefined, "b".repeat(32)])("rejects a replacement acknowledgement of %s before sending bytes", async (replaceId) => {
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const response = await original(url, init);
      return url.endsWith("/sessions") ? Response.json({ ...await response.json(), replaceId }) : response;
    }));
    await expect(uploadDirectFile(new File(["abcdef"], "revised.html"), callbacks,
      { kind: "html", replaceId: result.id })).rejects.toThrow("does not support");
    expect(TransferXhr.puts).toHaveLength(0);
    expect(requests).toHaveLength(1);
  });

  it("rejects a completion for a different HTML page and retains recovery identity", async () => {
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const response = await original(url, init);
      if (url.endsWith("/sessions")) return Response.json({ ...await response.json(), replaceId: result.id });
      if (url.endsWith("/complete")) return Response.json({ ...result, id: "b".repeat(32) });
      return response;
    }));
    await expect(uploadDirectFile(new File(["abcdef"], "revised.html"), callbacks,
      { kind: "html", replaceId: result.id })).rejects.toThrow("did not replace");
    expect(saved.size).toBe(1);
    expect(requests.some(request => request.method === "DELETE")).toBe(false);
  });

  it("starts a fresh session when an expired replacement is retried", async () => {
    const original = globalThis.fetch;
    const replacement = { ...result, kind: "html", filename: "revised.html", contentType: "text/html",
      url: `https://tools.example/artifacts/${result.id}` };
    let initializations = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const response = await original(url, init);
      if (url.endsWith("/sessions")) {
        expect(TransferXhr.puts).toHaveLength(0);
        if (initializations++ === 0) return Response.json({ error: "upload_not_found" }, { status: 404 });
        return Response.json({ ...await response.json(), replaceId: result.id });
      }
      return url.endsWith("/complete") ? Response.json(replacement) : response;
    }));
    const file = new File(["abcdef"], "revised.html", { lastModified: 123 });
    expect(await uploadDirectFile(file, callbacks, { kind: "html", replaceId: result.id })).toEqual(replacement);
    const sessions = requests.filter(request => request.url.endsWith("/sessions"));
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.body?.requestId).not.toBe(sessions[1]?.body?.requestId);
    expect(sessions.map(request => request.body?.replaceId)).toEqual([result.id, result.id]);
    expect(requests.find(request => request.url.endsWith("/complete"))).toMatchObject({
      url: `/api/external-uploads/sessions/${sessions[1]?.body?.requestId}/complete`, body: { sha256: result.sha256 }
    });
    expect(TransferXhr.puts).toHaveLength(2);
    expect(saved.size).toBe(0);
  });

  it.each(["source_changed", "wrong_response_digest"])("retains recovery identity after %s", async failure => {
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const response = await original(url, init);
      if (url.endsWith("/sessions")) return Response.json({ ...await response.json(), replaceId: result.id, state: "completing" });
      if (url.endsWith("/complete")) return failure === "source_changed"
        ? Response.json({ error: "source_changed", message: "The source file does not match the stored upload." }, { status: 409 })
        : Response.json({ ...result, sha256: "0".repeat(64) });
      return response;
    }));
    await expect(uploadDirectFile(new File(["abcdef"], "revised.html"), callbacks,
      { kind: "html", replaceId: result.id })).rejects.toThrow(/source|selected file/);
    expect(requests.find(request => request.url.endsWith("/complete"))?.body).toEqual({ sha256: result.sha256 });
    expect(TransferXhr.puts).toHaveLength(0);
    expect(saved.size).toBe(1);
    expect(requests.some(request => request.method === "DELETE")).toBe(false);
  });

  it("abandons the durable session after an explicit cancellation", async () => {
    let cancelled = false;
    const pending = uploadDirectFile(new File(["abcdef"], "fixture.bin"), {
      ...callbacks, onProgress: () => { cancelled = true; }, isCancelled: () => cancelled
    });
    await expect(pending).rejects.toThrow("cancelled");
    expect(requests.filter(request => request.method === "DELETE")).toHaveLength(1);
    expect(saved.size).toBe(0);
  });

  it.each(["parts", "complete"] as const)("aborts a pending %s request and ignores a late successful response after cancellation", async (action) => {
    const original = globalThis.fetch;
    const entered = deferred();
    const release = deferred();
    let pendingSignal: AbortSignal | null | undefined;
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const response = await original(url, init);
      if (url.endsWith("/" + action)) {
        calls += 1;
        pendingSignal = init.signal;
        entered.resolve();
        await release.promise;
      }
      return response;
    }));
    const controller = new AbortController();
    const pending = uploadDirectFile(new File(["abcdef"], "fixture.bin"), { ...callbacks, signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await entered.promise;
    const putsBeforeCancel = TransferXhr.puts.length;
    controller.abort();
    expect(pendingSignal?.aborted).toBe(true);
    release.resolve();
    await rejected;
    expect(calls).toBe(1);
    expect(TransferXhr.puts).toHaveLength(putsBeforeCancel);
    expect(requests.filter(request => request.method === "DELETE")).toHaveLength(1);
    expect(saved.size).toBe(0);
  });

  it("stops control retries when the caller aborts an in-flight fetch", async () => {
    const original = globalThis.fetch;
    const entered = deferred();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (!url.endsWith("/parts")) return original(url, init);
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        entered.resolve();
      });
    }));
    const controller = new AbortController();
    const pending = uploadDirectFile(new File(["abcdef"], "fixture.bin"), { ...callbacks, signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await entered.promise;
    controller.abort();
    await rejected;
    expect(calls).toBe(1);
    expect(TransferXhr.puts).toHaveLength(0);
    expect(saved.size).toBe(0);
  });

  it("keeps actionable session and size errors", () => {
    expect(friendlyUploadError(401)).toContain("Sign in again");
    expect(friendlyUploadError(413)).toContain("size limit");
    expect(friendlyUploadError(503)).toContain("Wait a moment");
  });
});

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
