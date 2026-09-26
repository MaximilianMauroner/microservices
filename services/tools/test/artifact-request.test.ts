import { describe, expect, it } from "vitest";
import { handleArtifactRequest } from "../src/route-handlers.js";

describe("artifact requests", () => {
  it("answers quietly when the browser closed the connection during the read", async () => {
    const controller = new AbortController();
    const request = new Request("https://tools.example/artifacts/id", { signal: controller.signal });

    const response = await handleArtifactRequest(request, async () => {
      controller.abort();
      throw new DOMException("Request aborted", "AbortError");
    }, []);

    expect(response.status).toBe(499);
  });

  it("still fails when storage breaks for a connected browser", async () => {
    const request = new Request("https://tools.example/artifacts/id");

    await expect(handleArtifactRequest(request, async () => {
      throw new Error("storage unavailable");
    }, [])).rejects.toThrow("storage unavailable");
  });
});
