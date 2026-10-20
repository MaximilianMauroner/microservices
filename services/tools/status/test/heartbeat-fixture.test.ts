import { describe, expect, it, vi } from "vitest";
import { validatedMonitorUrl } from "@tools-platform/domain";
import { fixtureFetcher, heartbeatFixture } from "./heartbeat-fixture.js";
import { probeTarget } from "../src/probe.js";

const environment = {
  TOOLS_JOURNEY_FIXTURE: "tools-local-12345678-1234-1234-1234-123456789abc",
  TOOLS_JOURNEY_ORIGIN: "http://127.0.0.1:43210",
  DATABASE_URL: "postgres://local:local@127.0.0.1:43211/postgres",
  TOWER_HEARTBEAT_TOKEN: "test-heartbeat-token",
  TOOLS_S3_ENDPOINT: "http://127.0.0.1:43212", TOOLS_S3_BUCKET: "tools", TOOLS_S3_REGION: "us-east-1",
  TOOLS_S3_ACCESS_KEY_ID: "local-access", TOOLS_S3_SECRET_ACCESS_KEY: "local-secret", TOOLS_S3_FORCE_PATH_STYLE: "true",
};

describe("owned heartbeat fixture", () => {
  it.each([
    { DATABASE_URL: "postgres://user:pw@external.example/postgres" },
    { TOOLS_JOURNEY_ORIGIN: "https://external.example" },
    { TOOLS_S3_ENDPOINT: "https://external.example" },
    { TOOLS_JOURNEY_FIXTURE: "unowned" },
    { DISCORD_WEBHOOK_URL: "https://external.example/hook" },
    { TOOLS_S3_FORCE_PATH_STYLE: "false" },
  ])("refuses unowned settings before resource creation %j", (overrides) => {
    expect(() => heartbeatFixture({ ...environment, ...overrides })).toThrow();
  });

  it("forwards only an exact fixture URL to real loopback HTTP while keeping the production literal-IP guard", async () => {
    const fixture = heartbeatFixture(environment);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const { fetcher, requested } = fixtureFetcher(fixture, transport);
    const result = await probeTarget(fixture.towerUrl, { fetcher, runId: "run", observationId: "observation" });
    expect(result).toMatchObject({ success: true, statusCode: 200 });
    expect(requested).toEqual([fixture.towerUrl]);
    expect(transport).toHaveBeenCalledWith(`${fixture.origin}/health/tower`, expect.objectContaining({ method: "GET", redirect: "manual", signal: expect.any(AbortSignal) }));
    expect(() => validatedMonitorUrl(`${fixture.origin}/health/tower`)).toThrow();
  });

  it.each([
    "https://external.example/health/tower", "http://localhost:43210/health/tower?extra=1",
    "http://localhost:43210/health/tower#fragment", "http://localhost:43213/health/tower",
    "http://127.0.0.1:43210/health/tower", "http://localhost:43210/unlisted",
  ])("refuses unknown URL %s before any transport call", async (url) => {
    const transport = vi.fn<typeof fetch>();
    const { fetcher } = fixtureFetcher(heartbeatFixture(environment), transport);
    await expect(fetcher(url, { method: "GET", redirect: "manual" })).rejects.toThrow("unknown monitor URL");
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses an external redirect without fetching it", async () => {
    const fixture = heartbeatFixture(environment);
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://external.example/" } }));
    const { fetcher } = fixtureFetcher(fixture, transport);
    const result = await probeTarget(fixture.towerUrl, { fetcher, runId: "run", observationId: "observation" });
    expect(result.success).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toBe(`${fixture.origin}/health/tower`);
  });
});
