import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tools = pgSchema("tools");
const artifacts = pgSchema("artifacts");

export const checkRuns = tools.table("check_runs", {
  id: text("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const observations = tools.table("observations", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => checkRuns.id),
  monitorId: text("monitor_id").notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  success: boolean("success").notNull(),
  statusCode: integer("status_code"),
  latencyMs: integer("latency_ms").notNull(),
  errorCode: text("error_code"),
}, (table) => [index("observations_monitor_checked_idx").on(table.monitorId, table.checkedAt)]);

export const incidents = tools.table("incidents", {
  id: text("id").primaryKey(),
  monitorId: text("monitor_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  openingObservationId: text("opening_observation_id"),
  closingObservationId: text("closing_observation_id"),
}, (table) => [index("incidents_monitor_started_idx").on(table.monitorId, table.startedAt)]);

export const heartbeats = tools.table("heartbeats", {
  monitorId: text("monitor_id").primaryKey(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
});

export const monitorOverrides = tools.table("monitor_overrides", {
  monitorId: text("monitor_id").primaryKey(),
  paused: boolean("paused").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const scheduledTaskRuns = tools.table("scheduled_task_runs", {
  taskId: text("task_id").notNull(),
  slot: timestamp("slot", { withTimezone: true }).notNull(),
  ownerId: text("owner_id").notNull(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  result: jsonb("result").$type<Record<string, unknown>>(),
}, (table) => [primaryKey({ columns: [table.taskId, table.slot] })]);

export const checkerStates = tools.table("checker_states", {
  environment: text("environment").primaryKey(),
  revision: bigint("revision", { mode: "number" }).notNull().default(0),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const historyPartitions = tools.table("history_partitions", {
  environment: text("environment").notNull(),
  day: date("day").notNull(),
  revision: bigint("revision", { mode: "number" }).notNull().default(0),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [primaryKey({ columns: [table.environment, table.day] })]);

export const objects = artifacts.table("objects", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  bytes: bigint("bytes", { mode: "number" }).notNull(),
  objectKey: text("object_key").notNull().unique(),
  project: text("project"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  check("objects_kind_check", sql`${table.kind} in ('html', 'file')`),
  check("objects_bytes_check", sql`${table.bytes} >= 0`),
]);

export const operations = artifacts.table("operations", {
  operationId: uuid("operation_id").primaryKey(),
  artifactId: text("artifact_id").notNull(),
  ownerId: text("owner_id").notNull(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull(),
  operationKind: text("operation_kind").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("operations_kind_check", sql`${table.operationKind} in ('put_html', 'put_file', 'delete')`),
  index("artifact_operations_created_idx").on(table.createdAt),
  uniqueIndex("artifact_operations_artifact_idx").on(table.artifactId),
]);
