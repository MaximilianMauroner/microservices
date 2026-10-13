import crypto from "node:crypto";
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
  const result = { id: "a".repeat(32), filename: "fixture.bin", bytes: 6, kind: "file", contentType: "application/octet-stream", url: "https://tools.example/files/fixture" };

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

  it("retries a completion whose response was lost with the same session", async () => {
    completionResponsesLost = 1;
    const pending = uploadDirectFile(new File(["abcdef"], "fixture.bin"), callbacks);
    expect(await pending).toMatchObject(result);
    const completions = requests.filter(request => request.url.endsWith("/complete"));
    expect(completions).toHaveLength(2);
    expect(completions[0]?.url).toBe(completions[1]?.url);
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

  it("keeps actionable session and size errors", () => {
    expect(friendlyUploadError(401)).toContain("Sign in again");
    expect(friendlyUploadError(413)).toContain("size limit");
    expect(friendlyUploadError(503)).toContain("Wait a moment");
  });
});
