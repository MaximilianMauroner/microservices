import { Readable } from "node:stream";
import { createFetchApp } from "@tools-platform/artifact-publisher";
import { describe, expect, it, vi } from "vitest";
import {
  handleArtifactRequest,
  handleFieldGuideRequest
} from "../src/route-handlers.js";

describe("field-guide route cold-wake retries", () => {
  it("retries an idempotent decision-record submission with the same body", async () => {
    const bodies: unknown[] = [];
    const handler = vi.fn(async (request: Request) => {
      bodies.push(await request.json());
      return handler.mock.calls.length === 1
        ? new Response(null, { status: 500 })
        : Response.json({ status: "created", decisionRecordId: "record-id" }, { status: 201 });
    });
    const body = {
      idempotencyKey: "record-id",
      record: { decisionRecordId: "record-id" }
    };
    const request = new Request("https://tools.example.test/api/agent/decision-records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const response = await handleFieldGuideRequest(request, handler, [0]);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      status: "created",
      decisionRecordId: "record-id"
    });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(bodies).toEqual([body, body]);
  });

  it.each([
    ["POST", "/api/agent/candidates"],
    ["POST", "/api/review/decision-records/record-id/feedback"],
    ["GET", "/api/agent/decision-records"]
  ])("does not retry %s %s", async (method, path) => {
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    const request = new Request(`https://tools.example.test${path}`, { method });

    const response = await handleFieldGuideRequest(request, handler, [0]);

    expect(response.status).toBe(500);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(request);
  });
});

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
