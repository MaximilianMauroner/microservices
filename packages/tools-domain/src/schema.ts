import { SchemaDecodeError } from "./errors.js";
import { validatedMonitorUrl } from "./url.js";
import {
  AUDIT_SCHEMA_VERSION,
  CATALOG_SCHEMA_VERSION,
  CHECKER_STATE_SCHEMA_VERSION,
  HISTORY_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  type AdminAuditRecord,
  type CatalogDocument,
  type CatalogEntry,
  type CatalogGroup,
  type CatalogLink,
  type CheckerStateDocument,
  type CheckObservation,
  type Incident,
  type HistoryPartitionDocument,
  type HistoryObservation,
  type MonitorConfig,
  type MonitorState,
  type NotificationDelivery,
  type PrivateSnapshotDocument,
  type PublicCatalogEntry,
  type PublicGroup,
  type PublicLink,
  type PublicMonitorStatus,
  type PublicSnapshotDocument
} from "./types.js";

type JsonRecord = Record<string, unknown>;

export function decodeCatalogDocument(input: unknown): CatalogDocument {
  return parseCatalogV1(migrateCatalogDocument(input));
}

export function migrateCatalogDocument(input: unknown): unknown {
  const root = record(input, "$");
  const version = integer(root.schemaVersion, "$.schemaVersion");
  if (version === CATALOG_SCHEMA_VERSION) {
    return input;
  }
  if (version !== 0) {
    throw new SchemaDecodeError(
      "$.schemaVersion",
      `unsupported catalog schema version ${version}`
    );
  }

  return {
    ...root,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    groups: array(root.groups, "$.groups").map((value, index) => {
      const group = record(value, `$.groups[${index}]`);
      return {
        ...group,
        visibility: group.visibility ?? "private"
      };
    }),
    entries: array(root.entries, "$.entries").map((value, index) => {
      const entry = record(value, `$.entries[${index}]`);
      const monitor =
        entry.monitor === undefined
          ? undefined
          : {
              ...record(entry.monitor, `$.entries[${index}].monitor`),
              paused:
                record(entry.monitor, `$.entries[${index}].monitor`).paused ??
                false,
              scope:
                record(entry.monitor, `$.entries[${index}].monitor`).scope ??
                "public"
            };
      return {
        ...entry,
        visibility: entry.visibility ?? "private",
        lifecycle: entry.lifecycle ?? "active",
        links: array(entry.links, `$.entries[${index}].links`).map(
          (linkValue, linkIndex) => {
            const link = record(
              linkValue,
              `$.entries[${index}].links[${linkIndex}]`
            );
            return { ...link, access: link.access ?? "private" };
          }
        ),
        ...(monitor ? { monitor } : {})
      };
    })
  };
}

export function decodeCheckerStateDocument(
  input: unknown
): CheckerStateDocument {
  return parseCheckerStateV1(migrateCheckerStateDocument(input));
}

export function migrateCheckerStateDocument(input: unknown): unknown {
  const root = record(input, "$");
  const version = integer(root.schemaVersion, "$.schemaVersion");
  if (version === CHECKER_STATE_SCHEMA_VERSION) {
    return input;
  }
  if (version !== 0) {
    throw new SchemaDecodeError(
      "$.schemaVersion",
      `unsupported checker-state schema version ${version}`
    );
  }
  return {
    ...root,
    schemaVersion: CHECKER_STATE_SCHEMA_VERSION,
    lastRunId: root.lastRunId ?? null,
    notifications: root.notifications ?? []
  };
}

export function decodePublicSnapshotDocument(
  input: unknown
): PublicSnapshotDocument {
  const root = record(migratePublicSnapshotDocument(input), "$");
  literal(root.schemaVersion, SNAPSHOT_SCHEMA_VERSION, "$.schemaVersion");
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: timestamp(root.generatedAt, "$.generatedAt"),
    catalogRevision: identifier(root.catalogRevision, "$.catalogRevision"),
    groups: array(root.groups, "$.groups").map(parsePublicGroup),
    entries: array(root.entries, "$.entries").map(parsePublicEntry),
    statuses: mapRecord(root.statuses, "$.statuses", parsePublicStatus)
  };
}

export function migratePublicSnapshotDocument(input: unknown): unknown {
  return migrateVersionOnly(input, SNAPSHOT_SCHEMA_VERSION, "public snapshot");
}

export function decodePrivateSnapshotDocument(
  input: unknown
): PrivateSnapshotDocument {
  const root = record(migratePrivateSnapshotDocument(input), "$");
  literal(root.schemaVersion, SNAPSHOT_SCHEMA_VERSION, "$.schemaVersion");
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: timestamp(root.generatedAt, "$.generatedAt"),
    catalogRevision: identifier(root.catalogRevision, "$.catalogRevision"),
    catalog: decodeCatalogDocument(root.catalog),
    state: decodeCheckerStateDocument(root.state)
  };
}

export function migratePrivateSnapshotDocument(input: unknown): unknown {
  return migrateVersionOnly(input, SNAPSHOT_SCHEMA_VERSION, "private snapshot");
}

export function decodeHistoryPartitionDocument(
  input: unknown
): HistoryPartitionDocument {
  const root = record(migrateHistoryPartitionDocument(input), "$");
  literal(root.schemaVersion, HISTORY_SCHEMA_VERSION, "$.schemaVersion");
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    day: calendarDay(root.day, "$.day"),
    updatedAt: timestamp(root.updatedAt, "$.updatedAt"),
    observations: array(root.observations, "$.observations").map(
      parseHistoryObservation
    ),
    incidents: array(root.incidents, "$.incidents").map((incident, index) =>
      parseIncidentAt(incident, `$.incidents[${index}]`)
    )
  };
}

export function migrateHistoryPartitionDocument(input: unknown): unknown {
  const root = record(input, "$");
  const version = integer(root.schemaVersion, "$.schemaVersion");
  if (version === HISTORY_SCHEMA_VERSION) {
    return input;
  }
  if (version !== 0 && version !== 1) {
    throw new SchemaDecodeError(
      "$.schemaVersion",
      `unsupported history schema version ${version}`
    );
  }
  return {
    ...root,
    schemaVersion: HISTORY_SCHEMA_VERSION,
    observations: array(root.observations, "$.observations").map(
      (value, index) => {
        const observation = record(value, `$.observations[${index}]`);
        return {
          ...observation,
          monitorId: observation.monitorId ?? null
        };
      }
    ),
    incidents: root.incidents ?? []
  };
}

export function decodeAdminAuditRecord(input: unknown): AdminAuditRecord {
  const root = record(input, "$");
  literal(root.schemaVersion, AUDIT_SCHEMA_VERSION, "$.schemaVersion");
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    id: identifier(root.id, "$.id"),
    actor: nonempty(root.actor, "$.actor"),
    occurredAt: timestamp(root.occurredAt, "$.occurredAt"),
    action: nonempty(root.action, "$.action"),
    targetType: enumeration(
      root.targetType,
      ["catalog", "group", "entry", "monitor"],
      "$.targetType"
    ),
    targetId:
      root.targetId === null
        ? null
        : identifier(root.targetId, "$.targetId"),
    catalogRevisionBefore: identifier(
      root.catalogRevisionBefore,
      "$.catalogRevisionBefore"
    ),
    catalogRevisionAfter: identifier(
      root.catalogRevisionAfter,
      "$.catalogRevisionAfter"
    )
  };
}

function parseCatalogV1(input: unknown): CatalogDocument {
  const root = record(input, "$");
  literal(root.schemaVersion, CATALOG_SCHEMA_VERSION, "$.schemaVersion");
  const groups = array(root.groups, "$.groups").map(parseGroup);
  const entries = array(root.entries, "$.entries").map(parseEntry);
  unique(groups.map(({ id }) => id), "$.groups");
  unique(entries.map(({ id }) => id), "$.entries");
  const groupIds = new Set(groups.map(({ id }) => id));
  for (const [index, entry] of entries.entries()) {
    if (!groupIds.has(entry.groupId)) {
      throw new SchemaDecodeError(
        `$.entries[${index}].groupId`,
        "references an unknown group"
      );
    }
  }
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    revision: identifier(root.revision, "$.revision"),
    updatedAt: timestamp(root.updatedAt, "$.updatedAt"),
    groups,
    entries
  };
}

function parseGroup(value: unknown, index: number): CatalogGroup {
  const path = `$.groups[${index}]`;
  const item = record(value, path);
  return {
    id: identifier(item.id, `${path}.id`),
    name: nonempty(item.name, `${path}.name`),
    ...(item.description === undefined
      ? {}
      : { description: string(item.description, `${path}.description`) }),
    order: nonnegativeInteger(item.order, `${path}.order`),
    visibility: enumeration(
      item.visibility,
      ["public", "private"],
      `${path}.visibility`
    )
  };
}

function parseLink(
  value: unknown,
  entryIndex: number,
  linkIndex: number
): CatalogLink {
  const path = `$.entries[${entryIndex}].links[${linkIndex}]`;
  const item = record(value, path);
  return {
    id: identifier(item.id, `${path}.id`),
    label: nonempty(item.label, `${path}.label`),
    url: httpUrl(item.url, `${path}.url`),
    access: enumeration(
      item.access,
      ["public", "restricted", "private"],
      `${path}.access`
    )
  };
}

function parseMonitor(value: unknown, path: string): MonitorConfig {
  const item = record(value, path);
  return {
    enabled: boolean(item.enabled, `${path}.enabled`),
    paused: boolean(item.paused, `${path}.paused`),
    scope: enumeration(
      item.scope,
      ["public", "tailscale"],
      `${path}.scope`
    ),
    url: monitorUrl(item.url, `${path}.url`)
  };
}

function parseEntry(value: unknown, index: number): CatalogEntry {
  const path = `$.entries[${index}]`;
  const item = record(value, path);
  const links = array(item.links, `${path}.links`).map((link, linkIndex) =>
    parseLink(link, index, linkIndex)
  );
  unique(links.map(({ id }) => id), `${path}.links`);
  return {
    id: identifier(item.id, `${path}.id`),
    groupId: identifier(item.groupId, `${path}.groupId`),
    name: nonempty(item.name, `${path}.name`),
    description: string(item.description, `${path}.description`),
    order: nonnegativeInteger(item.order, `${path}.order`),
    visibility: enumeration(
      item.visibility,
      ["public", "private"],
      `${path}.visibility`
    ),
    lifecycle: enumeration(
      item.lifecycle,
      ["active", "archived"],
      `${path}.lifecycle`
    ),
    links,
    ...(item.monitor === undefined
      ? {}
      : { monitor: parseMonitor(item.monitor, `${path}.monitor`) }),
    ...(item.privateNotes === undefined
      ? {}
      : { privateNotes: string(item.privateNotes, `${path}.privateNotes`) })
  };
}

function parseCheckerStateV1(input: unknown): CheckerStateDocument {
  const root = record(input, "$");
  literal(
    root.schemaVersion,
    CHECKER_STATE_SCHEMA_VERSION,
    "$.schemaVersion"
  );
  const monitors = mapRecord(root.monitors, "$.monitors", parseMonitorState);
  for (const [id, monitor] of Object.entries(monitors)) {
    if (id !== monitor.monitorId) {
      throw new SchemaDecodeError(
        `$.monitors.${id}.monitorId`,
        "must match its map key"
      );
    }
  }
  const incidents = array(root.incidents, "$.incidents").map(parseIncident);
  const notifications = array(root.notifications, "$.notifications").map(
    parseNotification
  );
  unique(incidents.map(({ id }) => id), "$.incidents");
  unique(notifications.map(({ id }) => id), "$.notifications");
  const incidentsById = new Map(incidents.map((incident) => [incident.id, incident]));
  for (const [id, monitor] of Object.entries(monitors)) {
    if (monitor.openIncidentId === null) {
      continue;
    }
    const incident = incidentsById.get(monitor.openIncidentId);
    if (
      !incident ||
      incident.monitorId !== id ||
      incident.resolvedAt !== null
    ) {
      throw new SchemaDecodeError(
        `$.monitors.${id}.openIncidentId`,
        "must reference this monitor's open incident"
      );
    }
  }
  for (const [index, notification] of notifications.entries()) {
    if (!incidentsById.has(notification.incidentId)) {
      throw new SchemaDecodeError(
        `$.notifications[${index}].incidentId`,
        "references an unknown incident"
      );
    }
  }
  return {
    schemaVersion: CHECKER_STATE_SCHEMA_VERSION,
    revision: identifier(root.revision, "$.revision"),
    updatedAt: timestamp(root.updatedAt, "$.updatedAt"),
    lastRunId:
      root.lastRunId === null
        ? null
        : identifier(root.lastRunId, "$.lastRunId"),
    monitors,
    incidents,
    notifications
  };
}

function parseObservation(value: unknown, path: string): CheckObservation {
  const item = record(value, path);
  return {
    id: identifier(item.id, `${path}.id`),
    runId: identifier(item.runId, `${path}.runId`),
    checkedAt: timestamp(item.checkedAt, `${path}.checkedAt`),
    success: boolean(item.success, `${path}.success`),
    statusCode:
      item.statusCode === null
        ? null
        : nonnegativeInteger(item.statusCode, `${path}.statusCode`),
    latencyMs: nonnegativeInteger(item.latencyMs, `${path}.latencyMs`),
    errorCode:
      item.errorCode === null
        ? null
        : enumeration(
            item.errorCode,
            [
              "blocked_address",
              "timeout",
              "network_error",
              "too_many_redirects",
              "http_error",
              "unavailable_from_railway"
            ],
            `${path}.errorCode`
          )
  };
}

function parseHistoryObservation(
  value: unknown,
  index: number
): HistoryObservation {
  const path = `$.observations[${index}]`;
  const item = record(value, path);
  return {
    ...parseObservation(item, path),
    monitorId:
      item.monitorId === null
        ? null
        : identifier(item.monitorId, `${path}.monitorId`)
  };
}

function parseMonitorState(value: unknown, path: string): MonitorState {
  const item = record(value, path);
  return {
    monitorId: identifier(item.monitorId, `${path}.monitorId`),
    status: enumeration(
      item.status,
      ["checking", "up", "down", "paused", "unavailable"],
      `${path}.status`
    ),
    consecutiveFailures: nonnegativeInteger(
      item.consecutiveFailures,
      `${path}.consecutiveFailures`
    ),
    latestObservation:
      item.latestObservation === null
        ? null
        : parseObservation(
            item.latestObservation,
            `${path}.latestObservation`
          ),
    openIncidentId:
      item.openIncidentId === null
        ? null
        : identifier(item.openIncidentId, `${path}.openIncidentId`)
  };
}

function parseIncident(value: unknown, index: number): Incident {
  return parseIncidentAt(value, `$.incidents[${index}]`);
}

function parseIncidentAt(value: unknown, path: string): Incident {
  const item = record(value, path);
  return {
    id: identifier(item.id, `${path}.id`),
    monitorId: identifier(item.monitorId, `${path}.monitorId`),
    startedAt: timestamp(item.startedAt, `${path}.startedAt`),
    openingObservationId: identifier(
      item.openingObservationId,
      `${path}.openingObservationId`
    ),
    resolvedAt:
      item.resolvedAt === null
        ? null
        : timestamp(item.resolvedAt, `${path}.resolvedAt`),
    closingObservationId:
      item.closingObservationId === null
        ? null
        : identifier(
            item.closingObservationId,
            `${path}.closingObservationId`
          )
  };
}

function migrateVersionOnly(
  input: unknown,
  currentVersion: number,
  label: string
): unknown {
  const root = record(input, "$");
  const version = integer(root.schemaVersion, "$.schemaVersion");
  if (version === currentVersion) {
    return input;
  }
  if (version !== 0) {
    throw new SchemaDecodeError(
      "$.schemaVersion",
      `unsupported ${label} schema version ${version}`
    );
  }
  return { ...root, schemaVersion: currentVersion };
}

function parseNotification(
  value: unknown,
  index: number
): NotificationDelivery {
  const path = `$.notifications[${index}]`;
  const item = record(value, path);
  return {
    id: identifier(item.id, `${path}.id`),
    incidentId: identifier(item.incidentId, `${path}.incidentId`),
    displayName:
      item.displayName === undefined || item.displayName === null
        ? null
        : nonempty(item.displayName, `${path}.displayName`),
    kind: enumeration(item.kind, ["down", "recovery"], `${path}.kind`),
    status: enumeration(
      item.status,
      ["pending", "delivered"],
      `${path}.status`
    ),
    attempts: nonnegativeInteger(item.attempts, `${path}.attempts`),
    nextAttemptAt:
      item.nextAttemptAt === null
        ? null
        : timestamp(item.nextAttemptAt, `${path}.nextAttemptAt`),
    claimToken:
      item.claimToken === undefined || item.claimToken === null
        ? null
        : identifier(item.claimToken, `${path}.claimToken`),
    claimedUntil:
      item.claimedUntil === undefined || item.claimedUntil === null
        ? null
        : timestamp(item.claimedUntil, `${path}.claimedUntil`),
    deliveredAt:
      item.deliveredAt === null
        ? null
        : timestamp(item.deliveredAt, `${path}.deliveredAt`),
    lastErrorCode:
      item.lastErrorCode === null
        ? null
        : nonempty(item.lastErrorCode, `${path}.lastErrorCode`)
  };
}

function parsePublicGroup(value: unknown, index: number): PublicGroup {
  const path = `$.groups[${index}]`;
  const item = record(value, path);
  return {
    id: identifier(item.id, `${path}.id`),
    name: nonempty(item.name, `${path}.name`),
    ...(item.description === undefined
      ? {}
      : { description: string(item.description, `${path}.description`) }),
    order: nonnegativeInteger(item.order, `${path}.order`)
  };
}

function parsePublicLink(value: unknown, path: string): PublicLink {
  const item = record(value, path);
  return {
    id: identifier(item.id, `${path}.id`),
    label: nonempty(item.label, `${path}.label`),
    url: httpUrl(item.url, `${path}.url`),
    access: enumeration(
      item.access,
      ["public", "restricted"],
      `${path}.access`
    )
  };
}

function parsePublicEntry(
  value: unknown,
  index: number
): PublicCatalogEntry {
  const path = `$.entries[${index}]`;
  const item = record(value, path);
  return {
    id: identifier(item.id, `${path}.id`),
    groupId: identifier(item.groupId, `${path}.groupId`),
    name: nonempty(item.name, `${path}.name`),
    description: string(item.description, `${path}.description`),
    order: nonnegativeInteger(item.order, `${path}.order`),
    links: array(item.links, `${path}.links`).map((link, linkIndex) =>
      parsePublicLink(link, `${path}.links[${linkIndex}]`)
    )
  };
}

function parsePublicStatus(
  value: unknown,
  path: string
): PublicMonitorStatus {
  const item = record(value, path);
  return {
    monitorId: identifier(item.monitorId, `${path}.monitorId`),
    status: enumeration(
      item.status,
      ["checking", "up", "down", "paused", "unavailable"],
      `${path}.status`
    ),
    checkedAt:
      item.checkedAt === null
        ? null
        : timestamp(item.checkedAt, `${path}.checkedAt`),
    latencyMs:
      item.latencyMs === null
        ? null
        : nonnegativeInteger(item.latencyMs, `${path}.latencyMs`),
    statusCode:
      item.statusCode === null
        ? null
        : nonnegativeInteger(item.statusCode, `${path}.statusCode`)
  };
}

function record(value: unknown, path: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SchemaDecodeError(path, "must be an object");
  }
  return value as JsonRecord;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new SchemaDecodeError(path, "must be an array");
  }
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new SchemaDecodeError(path, "must be a string");
  }
  return value;
}

function nonempty(value: unknown, path: string): string {
  const result = string(value, path);
  if (!result.trim()) {
    throw new SchemaDecodeError(path, "must not be empty");
  }
  return result;
}

function identifier(value: unknown, path: string): string {
  const result = nonempty(value, path);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) {
    throw new SchemaDecodeError(
      path,
      "must contain only URL-safe identifier characters"
    );
  }
  return result;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new SchemaDecodeError(path, "must be a boolean");
  }
  return value;
}

function integer(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new SchemaDecodeError(path, "must be an integer");
  }
  return value as number;
}

function nonnegativeInteger(value: unknown, path: string): number {
  const result = integer(value, path);
  if (result < 0) {
    throw new SchemaDecodeError(path, "must not be negative");
  }
  return result;
}

function timestamp(value: unknown, path: string): string {
  const result = string(value, path);
  const parsed = new Date(result);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== result
  ) {
    throw new SchemaDecodeError(path, "must be a canonical UTC timestamp");
  }
  return result;
}

function calendarDay(value: unknown, path: string): string {
  const result = string(value, path);
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== result
  ) {
    throw new SchemaDecodeError(path, "must be a valid YYYY-MM-DD date");
  }
  return result;
}

function httpUrl(value: unknown, path: string): string {
  const result = string(value, path);
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    throw new SchemaDecodeError(path, "must be an absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SchemaDecodeError(path, "must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new SchemaDecodeError(path, "must not contain credentials");
  }
  return url.toString();
}

function monitorUrl(value: unknown, path: string): string {
  const result = string(value, path);
  try {
    return validatedMonitorUrl(result).toString();
  } catch {
    throw new SchemaDecodeError(
      path,
      "must be a public HTTP(S) URL without embedded credentials"
    );
  }
}

function literal<const Value extends number>(
  value: unknown,
  expected: Value,
  path: string
): Value {
  if (value !== expected) {
    throw new SchemaDecodeError(path, `must equal ${expected}`);
  }
  return expected;
}

function enumeration<const Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  path: string
): Value {
  if (typeof value !== "string" || !allowed.includes(value as Value)) {
    throw new SchemaDecodeError(
      path,
      `must be one of ${allowed.join(", ")}`
    );
  }
  return value as Value;
}

function mapRecord<Value>(
  value: unknown,
  path: string,
  parser: (item: unknown, itemPath: string) => Value
): Record<string, Value> {
  const source = record(value, path);
  const result: Record<string, Value> = {};
  for (const [key, item] of Object.entries(source)) {
    identifier(key, `${path} key`);
    result[key] = parser(item, `${path}.${key}`);
  }
  return result;
}

function unique(values: string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw new SchemaDecodeError(path, "contains duplicate IDs");
  }
}
