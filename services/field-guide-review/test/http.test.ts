import { describe, expect, it } from "vitest";
import {
  MAX_JSON_BYTES,
  PayloadTooLargeError,
  htmlResponse,
  jsonResponse,
  readJson,
  textResponse,
} from "../src/http.js";

describe("Fetch response primitives", () => {
  it.each([
    [jsonResponse({ ok: true }), "application/json; charset=utf-8"],
    [htmlResponse("<p>ok</p>"), "text/html; charset=utf-8"],
    [textResponse("ok"), "text/plain; charset=utf-8"],
  ])("sets content type and common security headers", (response, contentType) => {
    expect(response.headers.get("content-type")).toBe(contentType);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("keeps the required payload error when stream cancellation rejects", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(MAX_JSON_BYTES + 1));
      },
      cancel() {
        cancelled = true;
        return Promise.reject(new Error("cancel failed"));
      },
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      body,
      duplex: "half",
    };
    const request = new Request("https://reviews.example", init);

    await expect(readJson(request)).rejects.toEqual(
      new PayloadTooLargeError("JSON body exceeds 128 KiB."),
    );
    expect(cancelled).toBe(true);
  });
});
