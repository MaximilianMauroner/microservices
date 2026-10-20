import assert from "node:assert/strict";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import postgres from "postgres";
import {
  BUCKET_KEYS, decodeCheckerStateDocument, decodePrivateSnapshotDocument, decodePublicSnapshotDocument,
} from "@tools-platform/domain";
import { createPostgresCheckerStore, executeChecker } from "../src/index.js";
import { persistedJsonValue } from "../src/postgres-store.js";
import { fixtureFetcher, heartbeatFixture } from "./heartbeat-fixture.js";

export async function verifyHeartbeatJourney(environment: Readonly<Record<string, string | undefined>>) {
  const fixture = heartbeatFixture(environment);
  const { config, source, token, origin } = fixture;
  const sql = postgres(config.databaseUrl, {
    max: 1, connect_timeout: 5,
    connection: { statement_timeout: 5_000, lock_timeout: 5_000 },
  });
  const storage = new S3Client({
    endpoint: config.bucket.endpoint, region: config.bucket.region, forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: config.bucket.accessKeyId, secretAccessKey: config.bucket.secretAccessKey },
  });
  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(new URL(path, origin), { ...init, redirect: "manual", signal: AbortSignal.timeout(5_000) });
    const body = await response.text();
    return { status: response.status, body };
  }
  async function snapshot(key: string) {
    const signal = AbortSignal.timeout(5_000);
    const response = await storage.send(new GetObjectCommand({ Bucket: config.bucket.name, Key: key }), { abortSignal: signal });
    assert(response.Body, "The snapshot must have a body.");
    const body = response.Body;
    const abort = () => { if ("destroy" in body) body.destroy(new Error("Snapshot read exceeded its deadline.")); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      const value: unknown = JSON.parse(await body.transformToString());
      return { value, etag: response.ETag };
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  try {
    const startedAt = Date.now();
    assert.equal((await sql`select monitor_id from tools.heartbeats`).length, 0, "A fresh fixture must have no canonical heartbeat.");
    const initial = await request("/health/tower");
    assert.equal(initial.status, 503);
    assert.deepEqual(JSON.parse(initial.body), { ok: false, error: "heartbeat_stale" });
    for (const authorization of [undefined, "Bearer invalid-heartbeat-fixture-token"]) {
      const denied = await request("/api/status/heartbeats/tower", { method: "POST", headers: authorization ? { Authorization: authorization } : {} });
      assert.equal(denied.status, 401, "Missing and invalid bearer tokens must be denied.");
      assert.equal((await sql`select monitor_id from tools.heartbeats`).length, 0, "Denied requests must not write a heartbeat.");
    }
    const postedAt = Date.now();
    const accepted = await request("/api/status/heartbeats/tower", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    assert.equal(accepted.status, 204);
    assert.equal(accepted.body, "");
    const heartbeats = await sql<{ monitor_id: string; last_seen_at: Date }[]>`select monitor_id, last_seen_at from tools.heartbeats`;
    assert.equal(heartbeats.length, 1);
    assert.equal(heartbeats[0].monitor_id, "tower");
    const lastSeenAt = heartbeats[0].last_seen_at.getTime();
    assert(lastSeenAt >= postedAt && lastSeenAt <= Date.now(), "The real POST must persist a fresh canonical timestamp.");
    const healthy = await request("/health/tower");
    assert.equal(healthy.status, 200);
    assert.deepEqual(JSON.parse(healthy.body), { ok: true });

    assert.equal((await sql`select id from tools.check_runs`).length, 0, "The checker must start without a prior run.");
    assert.equal((await sql`select id from tools.observations`).length, 0, "The checker must start without prior observations.");
    assert.equal((await sql`select environment from tools.checker_states`).length, 0, "The checker must start without prior state.");
    const initialPrivate = await snapshot(BUCKET_KEYS.privateSnapshot);
    const initialPublic = await snapshot(BUCKET_KEYS.publicSnapshot);
    assert.equal(decodePrivateSnapshotDocument(initialPrivate.value).state.lastRunId, null);
    await sql`insert into tools.monitor_overrides (monitor_id, paused, updated_at)
      values ('tower', false, now()), ('local-control', true, now())`;
    const transport = fixtureFetcher(fixture);
    const events: { event: string; fields: Readonly<Record<string, unknown>> }[] = [];
    const store = await createPostgresCheckerStore(config, source);
    await executeChecker({
      config, store, monitorDefinitions: source.definitions, fetcher: transport.fetcher,
      logger: {
        info(event, fields) { events.push({ event, fields: fields ?? {} }); },
        error(event, fields) { events.push({ event, fields: fields ?? {} }); },
      },
    });
    assert.deepEqual(transport.requested, [fixture.towerUrl], "Only Tower may be probed. The canonical control override must win.");
    assert(!events.some(({ event }) => event === "checker_run_duplicate"), "The checker run must be new.");
    const completion = events.filter(({ event }) => event === "checker_run_complete");
    assert.equal(completion.length, 1);
    assert.equal(completion[0].fields.notificationsAttempted, 0);
    const runs = await sql<{ id: string; started_at: Date; completed_at: Date }[]>`select id, started_at, completed_at from tools.check_runs`;
    assert.equal(runs.length, 1, "One new canonical run is required.");
    const run = runs[0];
    assert.equal(completion[0].fields.runId, run.id);
    assert(run.started_at.getTime() >= startedAt && run.completed_at.getTime() <= Date.now());
    const rows = await sql<{ id: string; run_id: string; monitor_id: string; checked_at: Date; success: boolean; status_code: number; error_code: string | null }[]>`
      select id, run_id, monitor_id, checked_at, success, status_code, error_code from tools.observations`;
    assert.equal(rows.length, 1, "Only one fresh observation may exist. Paused control must have none.");
    const observation = rows[0];
    assert.equal(observation.monitor_id, "tower");
    assert.equal(observation.run_id, run.id);
    assert.equal(observation.success, true);
    assert.equal(observation.status_code, 200);
    assert.equal(observation.error_code, null);
    assert(observation.checked_at.getTime() >= lastSeenAt && observation.checked_at.getTime() <= Date.now());
    const states = await sql<{ environment: string; revision: string; value: unknown }[]>`select environment, revision::text, value from tools.checker_states`;
    assert.equal(states.length, 1);
    assert.equal(states[0].environment, config.environment);
    assert(BigInt(states[0].revision) > 0n);
    const state = decodeCheckerStateDocument(persistedJsonValue(states[0].value));
    assert.equal(state.lastRunId, run.id);
    assert.equal(state.revision, run.id);
    assert.deepEqual(Object.keys(state.monitors).sort(), ["local-control", "tower"]);
    assert.equal(state.monitors.tower.latestObservation?.id, observation.id);
    assert.equal(state.monitors.tower.latestObservation?.runId, run.id);
    assert.equal(state.monitors.tower.latestObservation?.checkedAt, observation.checked_at.toISOString());
    assert.equal(state.monitors.tower.status, "up");
    assert.equal(state.monitors["local-control"].status, "paused");
    assert.equal(state.monitors["local-control"].latestObservation, null);
    assert.deepEqual(state.notifications, []);
    assert.deepEqual(state.historyPending, []);
    const publishedPrivate = await snapshot(BUCKET_KEYS.privateSnapshot);
    const publishedPublic = await snapshot(BUCKET_KEYS.publicSnapshot);
    assert(publishedPrivate.etag && publishedPrivate.etag !== initialPrivate.etag, "The private snapshot must be newly published.");
    assert(publishedPublic.etag && publishedPublic.etag !== initialPublic.etag, "The public snapshot must be newly published.");
    const privateSnapshot = decodePrivateSnapshotDocument(publishedPrivate.value);
    const publicSnapshot = decodePublicSnapshotDocument(publishedPublic.value);
    assert.equal(privateSnapshot.catalogRevision, source.catalog.revision);
    assert.equal(publicSnapshot.catalogRevision, source.catalog.revision);
    assert.deepEqual(privateSnapshot.state, state, "The private snapshot must match the canonical checker state exactly.");
    assert.equal(privateSnapshot.generatedAt, state.updatedAt);
    assert.equal(publicSnapshot.generatedAt, state.updatedAt);
    assert.deepEqual(privateSnapshot.catalog.entries.map(({ id, monitor }) => [id, monitor?.paused]), [["tower", false], ["local-control", true]]);
    assert(!publicSnapshot.entries.some(({ id }) => id === "tower"));
    assert(!Object.hasOwn(publicSnapshot.statuses, "tower"));
    assert.deepEqual(publicSnapshot.entries.map(({ id }) => id), ["local-control"]);
    assert.equal(publicSnapshot.statuses["local-control"].status, "paused");
    return {
      fixture: config.environment, catalogRevision: source.catalog.revision,
      runId: run.id, observationId: observation.id, heartbeatAt: heartbeats[0].last_seen_at.toISOString(),
      generatedAt: privateSnapshot.generatedAt, privateSnapshotEtag: publishedPrivate.etag, publicSnapshotEtag: publishedPublic.etag,
    };
  } finally {
    storage.destroy();
    await sql.end({ timeout: 5 });
  }
}
