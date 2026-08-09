import postgres from "postgres";
import {
  decodeCatalogDocument,
  decodeCheckerStateDocument,
  decodeHistoryPartitionDocument,
  type CheckerStateDocument,
  type HistoryPartitionDocument
} from "@tools-platform/domain";
import catalogSource from "../../dashboard/config/initial-catalog.json" with { type: "json" };
import { CheckerConflictError, createS3CheckerStore, type CheckerStore } from "./bucket.js";
import type { CheckerConfig } from "./config.js";
import { loadMonitorDefinitions } from "./definitions.js";

/** Keeps runtime state in Postgres; S3 remains only the catalog/snapshot transport. */
export function createPostgresCheckerStore(config: CheckerConfig): CheckerStore {
  const sql = postgres(config.databaseUrl, { max: 4 });
  const snapshots = createS3CheckerStore(config.bucket);
  return {
    async readCatalog() {
      const catalog = decodeCatalogDocument(catalogSource);
      const definitions = loadMonitorDefinitions();
      const overrides = await sql<{ monitor_id: string; paused: boolean }[]>`select monitor_id, paused from tools.monitor_overrides`;
      const paused = new Map(overrides.map((row) => [row.monitor_id, row.paused]));
      const byId = new Map(definitions.map((definition) => [definition.id, definition]));
      return {
        etag: catalog.revision,
        value: {
          ...catalog,
          entries: catalog.entries.map((entry) => {
            const definition = byId.get(entry.id);
            return {
              ...entry,
              monitor: definition ? {
                tracking: definition.kind,
                enabled: true,
                paused: paused.get(definition.id) ?? false,
                scope: definition.scope === "tailnet" ? "tailscale" : "public",
                url: definition.kind === "http" ? definition.url : definition.checkUrl
              } : undefined
            };
          })
        }
      };
    },
    async readState() {
      const [row] = await sql<{ value: unknown; revision: number }[]>`
        select value, revision from tools.checker_states where environment = ${config.environment}`;
      return row ? { value: decodeCheckerStateDocument(row.value), etag: String(row.revision) } : null;
    },
    async readHistory(day) {
      const [row] = await sql<{ value: unknown; revision: number }[]>`
        select value, revision from tools.history_partitions where environment = ${config.environment} and day = ${day}::date`;
      return row ? { value: decodeHistoryPartitionDocument(row.value), etag: String(row.revision) } : null;
    },
    async listHistoryDays() {
      const rows = await sql<{ day: string }[]>`
        select day::text as day from tools.history_partitions where environment = ${config.environment} order by day`;
      return rows.map(({ day }) => day);
    },
    async writeState(value, expectedEtag) {
      decodeCheckerStateDocument(value);
      const revision = await guardedWrite(sql, config.environment, null, value, expectedEtag);
      await persistFacts(sql, value);
      return revision;
    },
    async writeHistory(value, expectedEtag) {
      decodeHistoryPartitionDocument(value);
      return guardedWrite(sql, config.environment, value.day, value, expectedEtag);
    },
    writePublicSnapshot: (value, signal) => snapshots.writePublicSnapshot(value, signal),
    writePrivateSnapshot: (value, signal) => snapshots.writePrivateSnapshot(value, signal),
    close() { snapshots.close(); void sql.end(); }
  };
}

type Sql = ReturnType<typeof postgres>;

async function guardedWrite(sql: Sql, environment: string, day: string | null, value: CheckerStateDocument | HistoryPartitionDocument, expectedEtag: string | null) {
  const json = JSON.stringify(value);
  return sql.begin(async (tx) => {
    const rows = day === null
      ? await tx<{ revision: number }[]>`select revision from tools.checker_states where environment = ${environment} for update`
      : await tx<{ revision: number }[]>`select revision from tools.history_partitions where environment = ${environment} and day = ${day}::date for update`;
    const current = rows[0]?.revision;
    if ((current === undefined ? null : String(current)) !== expectedEtag) throw new CheckerConflictError(day ?? environment);
    const next = (current ?? 0) + 1;
    if (day === null) {
      await tx`insert into tools.checker_states (environment, revision, value, updated_at) values (${environment}, ${next}, ${json}::jsonb, now())
        on conflict (environment) do update set revision = excluded.revision, value = excluded.value, updated_at = excluded.updated_at`;
    } else {
      await tx`insert into tools.history_partitions (environment, day, revision, value, updated_at) values (${environment}, ${day}::date, ${next}, ${json}::jsonb, now())
        on conflict (environment, day) do update set revision = excluded.revision, value = excluded.value, updated_at = excluded.updated_at`;
    }
    return String(next);
  });
}

async function persistFacts(sql: Sql, state: CheckerStateDocument) {
  if (state.lastRunId) await sql`insert into tools.check_runs (id, started_at, completed_at) values (${state.lastRunId}, ${state.updatedAt}, ${state.updatedAt}) on conflict (id) do update set completed_at = excluded.completed_at`;
  for (const [monitorId, monitor] of Object.entries(state.monitors)) {
    const observation = monitor.latestObservation;
    if (observation) await sql`insert into tools.observations (id, run_id, monitor_id, checked_at, success, status_code, latency_ms, error_code)
      values (${observation.id}, ${observation.runId}, ${monitorId}, ${observation.checkedAt}, ${observation.success}, ${observation.statusCode ?? null}, ${observation.latencyMs}, ${observation.errorCode ?? null}) on conflict (id) do nothing`;
  }
  for (const incident of state.incidents) await sql`insert into tools.incidents (id, monitor_id, started_at, resolved_at, opening_observation_id, closing_observation_id)
    values (${incident.id}, ${incident.monitorId}, ${incident.startedAt}, ${incident.resolvedAt}, ${incident.openingObservationId}, ${incident.closingObservationId})
    on conflict (id) do update set resolved_at = excluded.resolved_at, closing_observation_id = excluded.closing_observation_id`;
}
