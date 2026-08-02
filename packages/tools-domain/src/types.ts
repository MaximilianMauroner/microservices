export const CATALOG_SCHEMA_VERSION = 1 as const;
export const CHECKER_STATE_SCHEMA_VERSION = 2 as const;
export const SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const HISTORY_SCHEMA_VERSION = 2 as const;
export const AUDIT_SCHEMA_VERSION = 1 as const;

export type RunId = string;
export type Visibility = "public" | "private";
export type Lifecycle = "active" | "archived";
export type LinkAccess = "public" | "restricted" | "private";
export type MonitorScope = "public" | "tailscale";
export type MonitorStatus =
  | "checking"
  | "up"
  | "down"
  | "paused"
  | "unavailable";
export type CheckErrorCode =
  | "blocked_address"
  | "timeout"
  | "network_error"
  | "too_many_redirects"
  | "http_error"
  | "unavailable_from_railway";
export type NotificationKind = "down" | "recovery";
export type NotificationDeliveryStatus = "pending" | "delivered";

export interface CatalogGroup {
  id: string;
  name: string;
  description?: string;
  order: number;
  visibility: Visibility;
}

export interface CatalogLink {
  id: string;
  label: string;
  url: string;
  access: LinkAccess;
}

export interface MonitorConfig {
  enabled: boolean;
  paused: boolean;
  scope: MonitorScope;
  url: string;
}

export interface CatalogEntry {
  id: string;
  groupId: string;
  name: string;
  description: string;
  order: number;
  visibility: Visibility;
  lifecycle: Lifecycle;
  links: CatalogLink[];
  monitor?: MonitorConfig;
  privateNotes?: string;
}

export interface CatalogDocument {
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  revision: string;
  updatedAt: string;
  groups: CatalogGroup[];
  entries: CatalogEntry[];
}

export interface CheckObservation {
  id: string;
  runId: RunId;
  checkedAt: string;
  success: boolean;
  statusCode: number | null;
  latencyMs: number;
  errorCode: CheckErrorCode | null;
}

export interface MonitorState {
  monitorId: string;
  status: MonitorStatus;
  consecutiveFailures: number;
  latestObservation: CheckObservation | null;
  openIncidentId: string | null;
  uptimeDays?: UptimeDay[];
}

export interface UptimeDay {
  day: string;
  successfulChecks: number;
  totalChecks: number;
}

export interface Incident {
  id: string;
  monitorId: string;
  startedAt: string;
  openingObservationId: string;
  resolvedAt: string | null;
  closingObservationId: string | null;
}

export interface NotificationDelivery {
  id: string;
  incidentId: string;
  displayName: string | null;
  kind: NotificationKind;
  status: NotificationDeliveryStatus;
  attempts: number;
  nextAttemptAt: string | null;
  claimToken: string | null;
  claimedUntil: string | null;
  deliveredAt: string | null;
  lastErrorCode: string | null;
}

export interface HistoryReconciliation {
  day: string;
  incidentIds: string[];
}

export interface CheckerStateDocument {
  schemaVersion: typeof CHECKER_STATE_SCHEMA_VERSION;
  revision: string;
  updatedAt: string;
  lastRunId: RunId | null;
  monitors: Record<string, MonitorState>;
  incidents: Incident[];
  notifications: NotificationDelivery[];
  historyPending: HistoryReconciliation[];
}

export interface PublicLink {
  id: string;
  label: string;
  url: string;
  access: Exclude<LinkAccess, "private">;
}

export interface PublicCatalogEntry {
  id: string;
  groupId: string;
  name: string;
  description: string;
  order: number;
  links: PublicLink[];
}

export interface PublicGroup {
  id: string;
  name: string;
  description?: string;
  order: number;
}

export interface PublicMonitorStatus {
  monitorId: string;
  status: MonitorStatus;
  checkedAt: string | null;
  latencyMs: number | null;
  statusCode: number | null;
  uptimeDays?: UptimeDay[];
  downtimeRecords?: PublicDowntimeRecord[];
}

export interface PublicDowntimeRecord {
  startedAt: string;
  resolvedAt: string | null;
}

export interface PublicSnapshotDocument {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  generatedAt: string;
  catalogRevision: string;
  groups: PublicGroup[];
  entries: PublicCatalogEntry[];
  statuses: Record<string, PublicMonitorStatus>;
}

export interface PrivateSnapshotDocument {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  generatedAt: string;
  catalogRevision: string;
  catalog: CatalogDocument;
  state: CheckerStateDocument;
}

export interface HistoryPartitionDocument {
  schemaVersion: typeof HISTORY_SCHEMA_VERSION;
  day: string;
  updatedAt: string;
  observations: HistoryObservation[];
  incidents: Incident[];
}

export interface HistoryObservation extends CheckObservation {
  monitorId: string | null;
}

export interface AdminAuditRecord {
  schemaVersion: typeof AUDIT_SCHEMA_VERSION;
  id: string;
  actor: string;
  occurredAt: string;
  action: string;
  targetType: "catalog" | "group" | "entry" | "monitor";
  targetId: string | null;
  catalogRevisionBefore: string;
  catalogRevisionAfter: string;
}

export interface ObservationTransition {
  monitor: MonitorState;
  openedIncident: Incident | null;
  resolvedIncident: Incident | null;
  queuedNotification: Omit<NotificationDelivery, "id"> | null;
}
