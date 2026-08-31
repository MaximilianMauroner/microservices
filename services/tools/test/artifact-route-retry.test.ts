import { Readable } from "node:stream";
import { createFetchApp } from "@tools-platform/artifact-publisher";
import { describe, expect, it, vi } from "vitest";
import { handleArtifactRequest } from "../src/route-handlers.js";

describe("artifact route cold-wake retries", () => {
  it("hides a transient storage failure from a public artifact reader", async () => {
    const body = "<html><head></head><body>ok</body></html>";
    const getHtml = vi.fn()
      .mockRejectedValueOnce(new Error("dependency waking"))
      .mockResolvedValueOnce({
        body: Readable.from([body]),
        bytes: Buffer.byteLength(body),
        sha256: "a".repeat(64),
        lastModified: new Date("2026-08-31T00:00:00.000Z")
      });
    const publisher = createFetchApp({
      storage: { getHtml } as never,
      uploadToken: "local-test-token"
    });
    const request = new Request(
      `https://tools.example.test/artifacts/${"a".repeat(32)}`
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await handleArtifactRequest(request, publisher, [0]);

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("<body>ok</body>");
      expect(getHtml).toHaveBeenCalledTimes(2);
    } finally {
      error.mockRestore();
    }
  });

  it.each(["GET", "HEAD"])("retries a transient %s failure", async (method) => {
    const handler = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response("artifact"));
    const request = new Request(
      `https://tools.example.test/artifacts/${"a".repeat(32)}`,
      { method }
    );

    const response = await handleArtifactRequest(request, handler, [0]);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, request);
    expect(handler).toHaveBeenNthCalledWith(2, request);
  });

  it("never retries a mutation", async () => {
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    const request = new Request("https://tools.example.test/api/uploads", {
      method: "POST",
      body: "payload"
    });

    const response = await handleArtifactRequest(request, handler, [0]);

    expect(response.status).toBe(500);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
