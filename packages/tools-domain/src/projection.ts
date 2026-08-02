import {
  SNAPSHOT_SCHEMA_VERSION,
  type CatalogDocument,
  type CatalogLink,
  type CheckerStateDocument,
  type PrivateSnapshotDocument,
  type PublicMonitorStatus,
  type PublicSnapshotDocument
} from "./types.js";

export function projectPublicSnapshot(
  catalog: CatalogDocument,
  state: CheckerStateDocument,
  generatedAt: string
): PublicSnapshotDocument {
  const visibleGroupIds = new Set(
    catalog.groups
      .filter((group) => group.visibility === "public")
      .map(({ id }) => id)
  );
  const entries = catalog.entries
    .filter(
      (entry) =>
        entry.visibility === "public" &&
        entry.lifecycle === "active" &&
        visibleGroupIds.has(entry.groupId)
    )
    .sort(byOrderThenId)
    .map((entry) => ({
      id: entry.id,
      groupId: entry.groupId,
      name: entry.name,
      description: entry.description,
      order: entry.order,
      links: entry.links
        .filter(isPublicLink)
        .map(({ id, label, url, access }) => ({
          id,
          label,
          url,
          access
        }))
    }));
  const publicGroupIds = new Set(entries.map(({ groupId }) => groupId));
  const groups = catalog.groups
    .filter(
      (group) =>
        group.visibility === "public" && publicGroupIds.has(group.id)
    )
    .sort(byOrderThenId)
    .map(({ id, name, description, order }) => ({
      id,
      name,
      ...(description === undefined ? {} : { description }),
      order
    }));

  const statuses: Record<string, PublicMonitorStatus> = {};
  for (const entry of catalog.entries) {
    if (
      entry.visibility !== "public" ||
      entry.lifecycle !== "active" ||
      !visibleGroupIds.has(entry.groupId) ||
      !entry.monitor
    ) {
      continue;
    }
    const monitor = state.monitors[entry.id];
    const unavailable = entry.monitor.scope === "tailscale";
    statuses[entry.id] = {
      monitorId: entry.id,
      status: unavailable ? "unavailable" : (monitor?.status ?? "checking"),
      checkedAt: unavailable
        ? null
        : (monitor?.latestObservation?.checkedAt ?? null),
      latencyMs: unavailable
        ? null
        : (monitor?.latestObservation?.latencyMs ?? null),
      statusCode: unavailable
        ? null
        : (monitor?.latestObservation?.statusCode ?? null),
      uptimeDays: unavailable
        ? []
        : rollingUptimeDays(monitor?.uptimeDays ?? [], generatedAt).sort(
            (left, right) => left.day.localeCompare(right.day)
          ),
      downtimeRecords: unavailable
        ? []
        : rollingDowntimeRecords(
            state.incidents.filter(({ monitorId }) => monitorId === entry.id),
            generatedAt
          )
    };
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt,
    catalogRevision: catalog.revision,
    groups,
    entries,
    statuses
  };
}

function rollingDowntimeRecords(
  incidents: CheckerStateDocument["incidents"],
  generatedAt: string
) {
  const end = new Date(generatedAt);
  const start = new Date(end);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - 89);
  const startTimestamp = start.toISOString();
  return incidents
    .filter(
      ({ startedAt, resolvedAt }) =>
        startedAt <= generatedAt &&
        (resolvedAt === null || resolvedAt >= startTimestamp)
    )
    .map(({ startedAt, resolvedAt }) => ({ startedAt, resolvedAt }))
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

function rollingUptimeDays(
  days: NonNullable<CheckerStateDocument["monitors"][string]["uptimeDays"]>,
  generatedAt: string
) {
  const end = new Date(generatedAt);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 89);
  const startDay = start.toISOString().slice(0, 10);
  const endDay = end.toISOString().slice(0, 10);
  return days.filter(({ day }) => day >= startDay && day <= endDay);
}

export function projectPrivateSnapshot(
  catalog: CatalogDocument,
  state: CheckerStateDocument,
  generatedAt: string
): PrivateSnapshotDocument {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt,
    catalogRevision: catalog.revision,
    catalog,
    state
  };
}

function byOrderThenId(
  left: { id: string; order: number },
  right: { id: string; order: number }
) {
  return left.order - right.order || left.id.localeCompare(right.id);
}

function isPublicLink(
  link: CatalogLink
): link is CatalogLink & { access: "public" | "restricted" } {
  return link.access !== "private";
}
