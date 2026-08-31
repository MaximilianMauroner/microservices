import { describe, expect, it, vi } from "vitest";
import {
  TRANSIENT_RESPONSE_RETRY_DELAYS_MS,
  retryTransientFetch,
  retryTransientResponse
} from "../src/response-retry.js";

describe("transient response retries", () => {
  it("keeps cold-wake reads loading for about ten seconds", () => {
    expect(TRANSIENT_RESPONSE_RETRY_DELAYS_MS.reduce((total, delay) => total + delay, 0))
      .toBe(9_850);
  });

  it("retries a server error until a read succeeds", async () => {
    const operation = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));

    const response = await retryTransientResponse(operation, [0]);

    expect(response.status).toBe(200);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("retries a browser network failure during a read", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(Response.json({ ok: true }));

    const response = await retryTransientFetch(
      "https://tools.example.test/api/external-uploads",
      {},
      [0],
      fetcher
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns client errors without retrying", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));

    const response = await retryTransientFetch(
      "https://tools.example.test/api/external-uploads",
      {},
      [0],
      fetcher
    );

    expect(response.status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refuses to retry a mutation", async () => {
    const fetcher = vi.fn();

    await expect(retryTransientFetch(
      "https://tools.example.test/api/external-uploads",
      { method: "POST" },
      [0],
      fetcher
    )).rejects.toThrow("only supports GET and HEAD requests");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
