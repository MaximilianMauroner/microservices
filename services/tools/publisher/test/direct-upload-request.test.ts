import { describe, expect, it, vi } from "vitest";
import { handleDirectUpload } from "../src/direct-upload-request.js";
import type { DirectUploads } from "../src/direct-uploads.js";

const sessionId = "123e4567-e89b-42d3-a456-426614174002";
const owner = { audience: "native" } as const;
const options = { maxBytes: 100, maxHtmlBytes: 100, maxConcurrent: 1,
  retentionMs: 60_000, baseUrl: "https://tools.example.test", allowHtml: true };

function uploads(): DirectUploads {
  return { create: vi.fn(), status: vi.fn(), sign: vi.fn(), abort: vi.fn(), cleanup: vi.fn(), close: vi.fn(),
    complete: vi.fn<DirectUploads["complete"]>().mockResolvedValue({ id: "a".repeat(32),
      kind: "html", filename: "plan.html", contentType: "text/html", totalBytes: 4, partBytes: 20 * 1024 * 1024,
      sha256: "a".repeat(64) }) };
}

describe("direct completion request", () => {
  it.each([null, 42, "", "a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64)])("rejects an invalid expected SHA-256 %j", async sha256 => {
    const direct = uploads();
    const request = new Request(options.baseUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sha256 }) });
    await expect(handleDirectUpload(request, `${sessionId}/complete`, direct, owner, options))
      .rejects.toMatchObject({ status: 400, code: "invalid_upload" });
    expect(direct.complete).not.toHaveBeenCalled();
  });

  it("passes the expected digest to publication", async () => {
    const direct = uploads();
    const request = new Request(options.baseUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sha256: "a".repeat(64) }) });
    expect((await handleDirectUpload(request, `${sessionId}/complete`, direct, owner, options)).status).toBe(201);
    expect(direct.complete).toHaveBeenCalledWith(sessionId, owner, 1, request.signal, "a".repeat(64));
  });

  it.each([undefined, "", "{}"])("accepts legacy completion body %j", async body => {
    const direct = uploads();
    const request = new Request(options.baseUrl, { method: "POST", ...(body === undefined ? {} : { body }),
      ...(body === "{}" ? { headers: { "Content-Type": "application/json" } } : {}) });
    expect((await handleDirectUpload(request, `${sessionId}/complete`, direct, owner, options)).status).toBe(201);
    expect(direct.complete).toHaveBeenCalledWith(sessionId, owner, 1, request.signal, undefined);
  });

  it.each([
    ["malformed JSON", '{"sha256":', "application/json"],
    ["wrong content type", JSON.stringify({ sha256: "a".repeat(64) }), "text/plain"],
    ["a null description", "null", "application/json"],
    ["an oversized description", JSON.stringify({ sha256: "a".repeat(5000) }), "application/json"]
  ])("rejects %s", async (_label, body, contentType) => {
    const direct = uploads();
    const request = new Request(options.baseUrl, { method: "POST", body, headers: { "Content-Type": contentType } });
    await expect(handleDirectUpload(request, `${sessionId}/complete`, direct, owner, options))
      .rejects.toMatchObject({ status: 400, code: "invalid_upload" });
    expect(direct.complete).not.toHaveBeenCalled();
  });
});
