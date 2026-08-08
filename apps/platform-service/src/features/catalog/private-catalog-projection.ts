import type {
  PrivateSnapshotDocument,
  PublicMonitorStatus,
  PublicSnapshotDocument
} from "@tools-platform/domain";

/** Projects the authenticated catalog into the shared directory/status view model. */
export function projectPrivateCatalog(snapshot: PrivateSnapshotDocument, visibility: "all" | "private"): PublicSnapshotDocument {
  const groupVisibility = new Map(snapshot.catalog.groups.map((group) => [group.id, group.visibility]));
  const entries = snapshot.catalog.entries
    .filter((entry) => entry.lifecycle === "active" && (visibility === "all" || !(entry.visibility === "public" && groupVisibility.get(entry.groupId) === "public")))
    .map((entry) => ({
      id: entry.id,
      groupId: entry.groupId,
      name: entry.name,
      description: entry.description,
      order: entry.order,
      links: entry.links.map(({ id, label, url, access }) => ({ id, label, url, access: access === "private" ? "restricted" as const : access }))
    }));
  const entryIds = new Set(entries.map((entry) => entry.id));
  const statuses: Record<string, PublicMonitorStatus> = {};
  for (const entry of snapshot.catalog.entries) {
    if (!entryIds.has(entry.id) || !entry.monitor?.enabled) continue;
    const monitor = snapshot.state.monitors[entry.id];
    statuses[entry.id] = {
      monitorId: entry.id,
      status: monitor?.status ?? (entry.monitor.paused ? "paused" : "checking"),
      checkedAt: monitor?.latestObservation?.checkedAt ?? null,
      latencyMs: monitor?.latestObservation?.latencyMs ?? null,
      statusCode: monitor?.latestObservation?.statusCode ?? null,
      uptimeDays: monitor?.uptimeDays ?? [],
      downtimeRecords: snapshot.state.incidents.filter(({ monitorId }) => monitorId === entry.id).map(({ startedAt, resolvedAt }) => ({ startedAt, resolvedAt }))
    };
  }
  return {
    schemaVersion: snapshot.schemaVersion,
    generatedAt: snapshot.generatedAt,
    catalogRevision: snapshot.catalogRevision,
    groups: snapshot.catalog.groups.filter((group) => entries.some((entry) => entry.groupId === group.id)).map(({ id, name, description, order }) => ({ id, name, ...(description === undefined ? {} : { description }), order })),
    entries,
    statuses
  };
}
