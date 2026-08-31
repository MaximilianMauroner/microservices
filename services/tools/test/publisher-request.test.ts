import { describe, expect, it, vi } from "vitest";
import { fetchPublisherRead, waitForPublisher } from "../publisher/ui/publisher-request.js";

describe("Publisher cold-wake requests", () => {
  it("keeps an inventory read pending until Publisher responds", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ uploads: [] }));

    const response = await fetchPublisherRead(
      "/api/external-uploads",
      {},
      [0],
      fetcher
    );

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("waits for readiness before allowing a mutation to start", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));

    await waitForPublisher([0], fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/health/publisher",
      { credentials: "same-origin" }
    );
  });

  it("reports an unavailable Publisher after the retry budget", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));

    await expect(waitForPublisher([], fetcher))
      .rejects.toThrow("Publisher is still starting. Try again in a moment.");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
