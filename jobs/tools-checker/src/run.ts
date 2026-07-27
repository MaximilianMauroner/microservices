import { createHash } from "node:crypto";
import {
  CHECKER_STATE_SCHEMA_VERSION,
  HISTORY_SCHEMA_VERSION,
  applyObservation,
  projectPrivateSnapshot,
  projectPublicSnapshot,
  type CatalogEntry,
  type CheckObservation,
  type CheckerStateDocument,
  type HistoryObservation,
  type HistoryPartitionDocument,
  type Incident,
  type MonitorState,
  type NotificationDelivery
} from "@tools-platform/domain";
import type { CheckerConfig } from "./config.js";
import type { CheckerStore } from "./bucket.js";
import type { SafeLogger } from "./logger.js";
import { drainNotifications } from "./notifications.js";
import { probeTarget } from "./probe.js";

export interface RunDependencies {
  store: CheckerStore;
  config: CheckerConfig;
  logger: SafeLogger;
  fetcher?: typeof fetch;
  now?: () => Date;
  signal?: AbortSignal;
}

export interface CheckerRunResult {
  runId: string;
  duplicate: boolean;
  attemptedMonitorIds: string[];
  notificationsAttempted: number;
}

export async function runChecker(
  dependencies: RunDependencies
): Promise<CheckerRunResult> {
  const now = dependencies.now ?? (() => new Date());
  const invokedAt = now();
  const runId = createRunId(dependencies.config.environment, invokedAt);
  const [catalogObject, stateObject] = await Promise.all([
    dependencies.store.readCatalog(dependencies.signal),
    dependencies.store.readState(dependencies.signal)
  ]);
  const catalog = catalogObject.value;
  const initialState = stateObject?.value ?? emptyState(invokedAt);
  let state = synchronizeMonitorStates(initialState, catalog.entries, invokedAt);

  if (initialState.lastRunId === runId) {
    let stateEtag = stateObject?.etag;
    if (!stateEtag) {
      throw new Error("Duplicate run state is missing an ETag");
    }
    if (state !== initialState) {
      stateEtag = await dependencies.store.writeState(
        state,
        stateEtag,
        dependencies.signal
      );
    }
    const observations = observationsForRun(state, runId);
    await updateHistory(
      dependencies.store,
      state,
      observations,
      invokedAt,
      dependencies.signal
    );
    await pruneRawHistory(dependencies.store, invokedAt, dependencies.signal);
    await publishSnapshots(dependencies.store, catalog, state, dependencies.signal);
    const drained = await drainNotifications(
      state,
      catalog,
      dependencies.config.discordWebhookUrl,
      {
        expectedEtag: stateEtag,
        maxAttempts: dependencies.config.notificationAttemptLimit,
        persist: (value, expectedEtag, signal) =>
          dependencies.store.writeState(value, expectedEtag, signal),
        signal: dependencies.signal
      },
      dependencies.fetcher,
      now
    );
    if (drained.attempted > 0 || drained.etag !== stateEtag) {
      await dependencies.store.writePrivateSnapshot(
        projectPrivateSnapshot(catalog, drained.state, now().toISOString()),
        dependencies.signal
      );
    }
    dependencies.logger.info("checker_run_duplicate", {
      runId,
      notificationsAttempted: drained.attempted
    });
    return {
      runId,
      duplicate: true,
      attemptedMonitorIds: [],
      notificationsAttempted: drained.attempted
    };
  }

  const enabledEntries = catalog.entries
    .filter(
      (entry) =>
        entry.lifecycle === "active" &&
        entry.monitor?.enabled === true &&
        entry.monitor.paused === false
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const observations = await mapConcurrent(
    enabledEntries,
    dependencies.config.concurrency,
    (entry) => observeEntry(entry, runId, dependencies, now),
    dependencies.signal
  );
  const historyObservations = observations.map((observation, index) => ({
    ...observation,
    monitorId: enabledEntries[index].id
  }));

  for (let index = 0; index < enabledEntries.length; index += 1) {
    state = foldObservation(state, enabledEntries[index], observations[index]);
  }
  const completedAt = now().toISOString();
  state = {
    ...state,
    revision: runId,
    updatedAt: completedAt,
    lastRunId: runId
  };

  const stateEtag = await dependencies.store.writeState(
    state,
    stateObject?.etag ?? null,
    dependencies.signal
  );
  await updateHistory(
    dependencies.store,
    state,
    historyObservations,
    invokedAt,
    dependencies.signal
  );
  await pruneRawHistory(dependencies.store, invokedAt, dependencies.signal);
  await publishSnapshots(dependencies.store, catalog, state, dependencies.signal);

  const drained = await drainNotifications(
    state,
    catalog,
    dependencies.config.discordWebhookUrl,
    {
      expectedEtag: stateEtag,
      maxAttempts: dependencies.config.notificationAttemptLimit,
      persist: (value, expectedEtag, signal) =>
        dependencies.store.writeState(value, expectedEtag, signal),
      signal: dependencies.signal
    },
    dependencies.fetcher,
    now
  );
  if (drained.attempted > 0 || drained.etag !== stateEtag) {
    state = drained.state;
    await dependencies.store.writePrivateSnapshot(
      projectPrivateSnapshot(catalog, state, state.updatedAt),
      dependencies.signal
    );
  }

  dependencies.logger.info("checker_run_complete", {
    runId,
    monitorsAttempted: enabledEntries.length,
    notificationsAttempted: drained.attempted
  });
  return {
    runId,
    duplicate: false,
    attemptedMonitorIds: enabledEntries.map(({ id }) => id),
    notificationsAttempted: drained.attempted
  };
}

export function createRunId(environment: string, invokedAt: Date): string {
  const slotMs = 5 * 60 * 1000;
  const slot = new Date(
    Math.floor(invokedAt.getTime() / slotMs) * slotMs
  ).toISOString();
  return `run-${createHash("sha256")
    .update(environment)
    .update("\0")
    .update(slot)
    .digest("hex")
    .slice(0, 24)}`;
}

function emptyState(now: Date): CheckerStateDocument {
  return {
    schemaVersion: CHECKER_STATE_SCHEMA_VERSION,
    revision: "initial",
    updatedAt: now.toISOString(),
    lastRunId: null,
    monitors: {},
    incidents: [],
    notifications: []
  };
}

function synchronizeMonitorStates(
  state: CheckerStateDocument,
  entries: CatalogEntry[],
  now: Date
): CheckerStateDocument {
  const monitoredEntryIds = new Set(
    entries.filter(({ monitor }) => monitor !== undefined).map(({ id }) => id)
  );
  const removedMonitorIds = new Set(
    Object.keys(state.monitors).filter((id) => !monitoredEntryIds.has(id))
  );
  const monitors = Object.fromEntries(
    Object.entries(state.monitors).filter(([id]) => monitoredEntryIds.has(id))
  );
  let changed = removedMonitorIds.size > 0;
  for (const entry of entries) {
    if (!entry.monitor) {
      continue;
    }
    const existingMonitor = monitors[entry.id];
    const existing = existingMonitor ?? initialMonitor(entry.id);
    changed ||= existingMonitor === undefined;
    if (
      !entry.monitor.enabled ||
      entry.monitor.paused ||
      entry.lifecycle === "archived"
    ) {
      const updated = { ...existing, status: "paused" as const };
      monitors[entry.id] = updated;
      changed ||= updated.status !== existing.status;
    } else if (existing.status === "paused") {
      monitors[entry.id] = {
        ...existing,
        status: "checking",
        consecutiveFailures: 0
      };
      changed = true;
    } else {
      monitors[entry.id] = existing;
    }
  }
  const incidents = state.incidents.map((incident) =>
    removedMonitorIds.has(incident.monitorId) && incident.resolvedAt === null
      ? {
          ...incident,
          resolvedAt: now.toISOString(),
          closingObservationId: null
        }
      : incident
  );
  changed ||= incidents.some(
    (incident, index) => incident !== state.incidents[index]
  );
  return changed
    ? { ...state, updatedAt: now.toISOString(), monitors, incidents }
    : state;
}

function initialMonitor(monitorId: string): MonitorState {
  return {
    monitorId,
    status: "checking",
    consecutiveFailures: 0,
    latestObservation: null,
    openIncidentId: null
  };
}

async function observeEntry(
  entry: CatalogEntry,
  runId: string,
  dependencies: RunDependencies,
  now: () => Date
): Promise<CheckObservation> {
  const monitor = entry.monitor;
  if (!monitor) {
    throw new Error(`Enabled entry is missing monitor config: ${entry.id}`);
  }
  const observationId = stableId("observation", runId, entry.id);
  if (monitor.scope === "tailscale") {
    return {
      id: observationId,
      runId,
      checkedAt: now().toISOString(),
      success: false,
      statusCode: null,
      latencyMs: 0,
      errorCode: "unavailable_from_railway"
    };
  }
  return probeTarget(monitor.url, {
    fetcher: dependencies.fetcher,
    now: () => now().getTime(),
    timeoutMs: dependencies.config.probeTimeoutMs,
    observationId,
    runId,
    signal: dependencies.signal
  });
}

function foldObservation(
  state: CheckerStateDocument,
  entry: CatalogEntry,
  observation: CheckObservation
): CheckerStateDocument {
  const current = state.monitors[entry.id] ?? initialMonitor(entry.id);
  if (observation.errorCode === "unavailable_from_railway") {
    return {
      ...state,
      monitors: {
        ...state.monitors,
        [entry.id]: {
          ...current,
          status: "unavailable",
          consecutiveFailures: 0,
          latestObservation: observation
        }
      }
    };
  }

  const openIncident =
    current.openIncidentId === null
      ? null
      : (state.incidents.find(({ id }) => id === current.openIncidentId) ?? null);
  const transition = applyObservation(
    current,
    observation,
    { incidentId: stableId("incident", entry.id, observation.id) },
    openIncident
  );
  let incidents = state.incidents;
  if (transition.openedIncident) {
    incidents = [...incidents, transition.openedIncident];
  }
  if (transition.resolvedIncident) {
    incidents = incidents.map((incident) =>
      incident.id === transition.resolvedIncident?.id
        ? transition.resolvedIncident
        : incident
    );
  }
  const notifications = transition.queuedNotification
    ? [
        ...state.notifications,
        {
          id: stableId(
            "notification",
            transition.queuedNotification.incidentId,
            transition.queuedNotification.kind
          ),
          ...transition.queuedNotification,
          displayName: entry.name
        }
      ]
    : state.notifications;
  return {
    ...state,
    monitors: {
      ...state.monitors,
      [entry.id]: transition.monitor
    },
    incidents,
    notifications
  };
}

async function updateHistory(
  store: CheckerStore,
  state: CheckerStateDocument,
  observations: HistoryObservation[],
  invokedAt: Date,
  signal?: AbortSignal
): Promise<void> {
  const day = invokedAt.toISOString().slice(0, 10);
  const existing = await store.readHistory(day, signal);
  const known = new Set(
    existing?.value.observations.map(({ id }) => id) ?? []
  );
  const partition: HistoryPartitionDocument = {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    day,
    updatedAt: state.updatedAt,
    observations: [
      ...(existing?.value.observations ?? []),
      ...observations.filter(({ id }) => !known.has(id))
    ],
    incidents: mergeIncidents(
      (existing?.value.incidents ?? []).filter(
        (incident) => incident.startedAt.slice(0, 10) === day
      ),
      state.incidents.filter(
        (incident) => incident.startedAt.slice(0, 10) === day
      )
    )
  };
  await store.writeHistory(partition, existing?.etag ?? null, signal);

  const resolvedFromEarlierDays = state.incidents.filter(
    (incident) =>
      incident.resolvedAt?.slice(0, 10) === day &&
      incident.startedAt.slice(0, 10) !== day
  );
  for (const incident of resolvedFromEarlierDays) {
    const originDay = incident.startedAt.slice(0, 10);
    const origin = await store.readHistory(originDay, signal);
    if (!origin) {
      continue;
    }
    await store.writeHistory(
      {
        ...origin.value,
        updatedAt: state.updatedAt,
        incidents: mergeIncidents(origin.value.incidents, [incident])
      },
      origin.etag,
      signal
    );
  }
}

async function pruneRawHistory(
  store: CheckerStore,
  invokedAt: Date,
  signal?: AbortSignal
): Promise<void> {
  const cutoff = new Date(invokedAt);
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  const days = await store.listHistoryDays(signal);
  for (const day of days) {
    if (day >= cutoffDay) {
      continue;
    }
    const existing = await store.readHistory(day, signal);
    if (!existing || existing.value.observations.length === 0) {
      continue;
    }
    await store.writeHistory(
      {
        ...existing.value,
        updatedAt: invokedAt.toISOString(),
        observations: []
      },
      existing.etag,
      signal
    );
  }
}

function mergeIncidents(
  previous: Incident[],
  current: Incident[]
): Incident[] {
  const merged = new Map(previous.map((incident) => [incident.id, incident]));
  for (const incident of current) {
    merged.set(incident.id, incident);
  }
  return [...merged.values()].sort(
    (left, right) =>
      left.startedAt.localeCompare(right.startedAt) ||
      left.id.localeCompare(right.id)
  );
}

async function mapConcurrent<Value, Result>(
  values: readonly Value[],
  concurrency: number,
  mapper: (value: Value) => Promise<Result>,
  signal?: AbortSignal
): Promise<Result[]> {
  const results = new Array<Result>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        signal?.throwIfAborted();
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(values[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${createHash("sha256")
    .update(parts.join("\0"))
    .digest("hex")
    .slice(0, 24)}`;
}

function observationsForRun(
  state: CheckerStateDocument,
  runId: string
): HistoryObservation[] {
  return Object.entries(state.monitors)
    .map(([monitorId, { latestObservation }]) =>
      latestObservation ? { ...latestObservation, monitorId } : null
    )
    .filter(
      (observation): observation is HistoryObservation =>
        observation?.runId === runId
    )
    .sort(
      (left, right) =>
        left.checkedAt.localeCompare(right.checkedAt) ||
        left.id.localeCompare(right.id)
    );
}

async function publishSnapshots(
  store: CheckerStore,
  catalog: Parameters<typeof projectPublicSnapshot>[0],
  state: CheckerStateDocument,
  signal?: AbortSignal
): Promise<void> {
  await Promise.all([
    store.writePublicSnapshot(
      projectPublicSnapshot(catalog, state, state.updatedAt),
      signal
    ),
    store.writePrivateSnapshot(
      projectPrivateSnapshot(catalog, state, state.updatedAt),
      signal
    )
  ]);
}

export type { NotificationDelivery };
