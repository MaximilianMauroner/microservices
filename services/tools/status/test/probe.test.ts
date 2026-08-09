import { describe, expect, it, vi } from "vitest";
import { probeTarget } from "../src/probe.js";

const options = {
  observationId: "observation-1",
  runId: "run-1",
  now: vi.fn()
    .mockReturnValueOnce(1000)
    .mockReturnValue(1042)
};

describe("HTTP probing", () => {
  it("uses GET, manual redirects, and one total timeout result", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/health" }
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await probeTarget("https://example.com/", {
      ...options,
      fetcher
    });
    expect(result).toMatchObject({
      success: true,
      statusCode: 204,
      latencyMs: 42,
      errorCode: null
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: "GET",
      redirect: "manual"
    });
  });

  it("rejects private initial and redirect literals without fetching them", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/" }
        })
      );
    const initial = await probeTarget("http://10.0.0.1/", {
      ...options,
      fetcher
    });
    expect(initial.errorCode).toBe("blocked_address");
    expect(fetcher).not.toHaveBeenCalled();

    const redirected = await probeTarget("https://example.com/", {
      ...options,
      fetcher
    });
    expect(redirected.errorCode).toBe("blocked_address");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports HTTP failures and rejects a second redirect", async () => {
    const failed = await probeTarget("https://example.com/", {
      ...options,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, { status: 503 })
      )
    });
    expect(failed).toMatchObject({
      success: false,
      statusCode: 503,
      errorCode: "http_error"
    });

    const redirected = await probeTarget("https://example.com/", {
      ...options,
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(null, {
            status: 302,
            headers: { location: "/again" }
          })
        )
    });
    expect(redirected.errorCode).toBe("too_many_redirects");
  });

});
