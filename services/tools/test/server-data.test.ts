import { describe, expect, it } from "vitest";
import { retryTransientPlatformResponse } from "../src/server-data.js";

describe("internal platform data reads", () => {
  it("retries a transient mounted-service failure", async () => {
    let attempts = 0;

    const response = await retryTransientPlatformResponse(async () => {
      attempts += 1;
      return attempts === 1
        ? new Response(null, { status: 500 })
        : Response.json({ ok: true });
    }, [0]);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(attempts).toBe(2);
  });

  it("does not retry client errors", async () => {
    let attempts = 0;

    const response = await retryTransientPlatformResponse(async () => {
      attempts += 1;
      return new Response(null, { status: 404 });
    }, [0]);

    expect(response.status).toBe(404);
    expect(attempts).toBe(1);
  });

  it("keeps the final server error after the bounded retry budget", async () => {
    let attempts = 0;

    const response = await retryTransientPlatformResponse(async () => {
      attempts += 1;
      return new Response(null, { status: 503 });
    }, [0, 0]);

    expect(response.status).toBe(503);
    expect(attempts).toBe(3);
  });
});
