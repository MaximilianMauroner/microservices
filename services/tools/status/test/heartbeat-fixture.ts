import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CATALOG_SCHEMA_VERSION } from "@tools-platform/domain";
import type { CheckerCatalogSource } from "../src/postgres-store.js";
import type { CheckerConfig } from "../src/config.js";

function required(environment: Readonly<Record<string, string | undefined>>, name: string) {
  const value = environment[name];
  assert(value, `The owned heartbeat fixture requires ${name}.`);
  return value;
}

function loopbackOrigin(value: string) {
  const url = new URL(value);
  assert(url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port
    && url.origin === value && !url.username && !url.password, "The heartbeat fixture requires an exact owned loopback origin.");
  return url;
}

export function heartbeatFixture(environment: Readonly<Record<string, string | undefined>>) {
  const project = required(environment, "TOOLS_JOURNEY_FIXTURE");
  assert(/^tools-local-[a-f0-9-]{36}$/.test(project), "The heartbeat fixture requires an owned verification project.");
  const origin = loopbackOrigin(required(environment, "TOOLS_JOURNEY_ORIGIN"));
  const endpoint = loopbackOrigin(required(environment, "TOOLS_S3_ENDPOINT"));
  const databaseUrl = required(environment, "DATABASE_URL");
  const database = new URL(databaseUrl);
  assert(["postgres:", "postgresql:"].includes(database.protocol) && database.hostname === "127.0.0.1"
    && database.port && database.pathname === "/postgres" && !database.search && !database.hash,
  "The heartbeat fixture requires the owned loopback PostgreSQL database.");
  database.searchParams.set("connect_timeout", "5");
  database.searchParams.set("statement_timeout", "5000");
  database.searchParams.set("lock_timeout", "5000");
  assert(!environment.DISCORD_WEBHOOK_URL, "The heartbeat fixture refuses notification webhooks.");
  assert.equal(environment.TOOLS_S3_FORCE_PATH_STYLE, "true", "The heartbeat fixture requires owned path-style storage.");
  const token = required(environment, "TOWER_HEARTBEAT_TOKEN");
  const towerUrl = `http://localhost:${origin.port}/health/tower`;
  const controlUrl = `http://localhost:${origin.port}/live`;
  const source: CheckerCatalogSource = {
    catalog: {
      schemaVersion: CATALOG_SCHEMA_VERSION, revision: `heartbeat-${randomUUID()}`, updatedAt: new Date().toISOString(),
      groups: [{ id: "local", name: "Local verification", order: 0, visibility: "public" }],
      entries: [
        {
          id: "tower", groupId: "local", name: "Tower", description: "Owned heartbeat", order: 0,
          visibility: "private", lifecycle: "active", links: [],
          monitor: { tracking: "heartbeat", enabled: true, paused: true, scope: "public", url: towerUrl },
        },
        {
          id: "local-control", groupId: "local", name: "Paused control", description: "Owned control", order: 1,
          visibility: "public", lifecycle: "active", links: [],
          monitor: { tracking: "http", enabled: true, paused: false, scope: "public", url: controlUrl },
        },
      ],
    },
    definitions: [
      { id: "tower", kind: "heartbeat", scope: "public", checkUrl: towerUrl, staleAfterMs: 60_000 },
      { id: "local-control", kind: "http", scope: "public", url: controlUrl, expectedStatus: [200], timeoutMs: 5_000 },
    ],
    productMonitorIds: ["tower", "local-control"],
  };
  const config: CheckerConfig = {
    environment: project, databaseUrl: database.href,
    bucket: {
      name: required(environment, "TOOLS_S3_BUCKET"), endpoint: endpoint.origin,
      region: required(environment, "TOOLS_S3_REGION"), accessKeyId: required(environment, "TOOLS_S3_ACCESS_KEY_ID"),
      secretAccessKey: required(environment, "TOOLS_S3_SECRET_ACCESS_KEY"), forcePathStyle: true,
    },
    concurrency: 1, probeTimeoutMs: 5_000, runDeadlineMs: 30_000, notificationAttemptLimit: 1,
  };
  return { origin: origin.origin, token, towerUrl, controlUrl, source, config };
}

export function fixtureFetcher(fixture: ReturnType<typeof heartbeatFixture>, transport: typeof fetch = fetch) {
  const allowed = new Map([
    [fixture.towerUrl, `${fixture.origin}/health/tower`],
    [fixture.controlUrl, `${fixture.origin}/live`],
  ]);
  const requested: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const target = allowed.get(url);
    assert(target, "The heartbeat fixture refused an unknown monitor URL.");
    assert.equal(init?.method, "GET", "Checker probes must use GET.");
    assert.equal(init?.redirect, "manual", "Checker probes must not follow redirects automatically.");
    requested.push(url);
    const response = await transport(target, { ...init, redirect: "manual",
      signal: AbortSignal.any([AbortSignal.timeout(5_000), ...(init?.signal ? [init.signal] : [])]) });
    if (response.headers.has("location")) {
      const redirect = new URL(response.headers.get("location")!, url).href;
      if (!allowed.has(redirect)) {
        await response.body?.cancel();
        throw new Error("The heartbeat fixture refused an unknown redirect URL.");
      }
    }
    return response;
  };
  return { fetcher, requested };
}
