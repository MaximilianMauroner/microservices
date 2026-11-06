import { describe, expect, it } from "vitest";
import { readBoundedBody, RequestBodyTooLargeError } from "../../platform/request-body.js";

function streamed(chunks: number, chunkBytes: number) {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent === chunks) return controller.close();
      sent += 1;
      controller.enqueue(new Uint8Array(chunkBytes));
    }
  });
  return { request: new Request("https://tools.example.test/", { method: "POST", body, duplex: "half" } as RequestInit), sent: () => sent };
}

describe("bounded request body", () => {
  it("returns the whole body when it fits", async () => {
    const bytes = await readBoundedBody(new Request("https://tools.example.test/", { method: "POST", body: "hello" }), 5);
    expect(new TextDecoder().decode(bytes)).toBe("hello");
  });

  it("refuses a declared length over the limit without reading", async () => {
    const request = new Request("https://tools.example.test/", { method: "POST", body: "hello", headers: { "content-length": "6" } });
    await expect(readBoundedBody(request, 5)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("stops reading a streamed body with no declared length once it is over the limit", async () => {
    const { request, sent } = streamed(100, 1024);
    await expect(readBoundedBody(request, 4 * 1024)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(sent()).toBeLessThan(10);
  });

  it("returns undefined when there is no body", async () => {
    expect(await readBoundedBody(new Request("https://tools.example.test/"), 5)).toBeUndefined();
  });
});
