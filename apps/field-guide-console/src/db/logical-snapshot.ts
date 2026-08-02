import crypto from "node:crypto";
import type { Database } from "bun:sqlite";

export const TABLES = ["candidates", "review_rounds", "verdict_events", "application_receipts", "field_guide_schema_migrations", "decision_records", "decision_feedback_events", "decision_promotions", "decision_promotion_records"] as const;
export const SEQUENCED_TABLES = ["verdict_events", "decision_records", "decision_feedback_events"] as const;
export type TableName = (typeof TABLES)[number];
export type SequencedTableName = (typeof SEQUENCED_TABLES)[number];
export type SequenceState = { lastValue: string; isCalled: boolean; nextValue: string };
export type LogicalSnapshot = {
  tables: Record<TableName, readonly Record<string, unknown>[]>;
  counts: Record<TableName, number>;
  hashes: Record<TableName, string>;
  maxSequences: Record<SequencedTableName, string>;
  sequences: Record<SequencedTableName, SequenceState>;
};
export type SnapshotReport = {
  schema: 1;
  tables: Record<TableName, { count: number; hash: string }>;
  maxSequences: Record<SequencedTableName, string>;
  sequences: Record<SequencedTableName, SequenceState>;
};

const TIMESTAMPS = new Set(["created_at", "due_at", "reviewed_at", "next_review_at", "applied_at", "received_at", "promoted_at"]);
const bytewise = (left: string, right: string) => Buffer.compare(Buffer.from(left), Buffer.from(right));

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => bytewise(left, right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function hashRows(rows: readonly Record<string, unknown>[]) {
  const encoded = rows.map(canonicalJson).sort(bytewise);
  return crypto.createHash("sha256").update(encoded.join("\n")).digest("hex");
}

export function summarize(
  tables: LogicalSnapshot["tables"],
  sequences: LogicalSnapshot["sequences"],
): LogicalSnapshot {
  const counts = Object.fromEntries(TABLES.map((name) => [name, tables[name].length])) as Record<TableName, number>;
  const hashes = Object.fromEntries(TABLES.map((name) => [name, hashRows(tables[name])])) as Record<TableName, string>;
  const maxSequences = Object.fromEntries(SEQUENCED_TABLES.map((name) => [name, maximumSequence(tables[name])])) as Record<SequencedTableName, string>;
  return { tables, counts, hashes, maxSequences, sequences };
}

export function sqliteSequences(db: Database): LogicalSnapshot["sequences"] {
  return Object.fromEntries(SEQUENCED_TABLES.map((name) => {
    const row = db.query<{ seq: string }, [string]>("SELECT CAST(seq AS TEXT) seq FROM sqlite_sequence WHERE name=?").get(name);
    const state: SequenceState = row
      ? { lastValue: row.seq, isCalled: true, nextValue: (BigInt(row.seq) + 1n).toString() }
      : { lastValue: "1", isCalled: false, nextValue: "1" };
    return [name, state];
  })) as LogicalSnapshot["sequences"];
}

export function sqliteSnapshot(db: Database): LogicalSnapshot {
  const read = (table: TableName) => db.query<Record<string, unknown>, []>(`SELECT * FROM ${table}`).all().map(normalizeRow);
  const verdictEvents = db.query<Record<string, unknown>, []>("SELECT CAST(sequence AS TEXT) sequence,decision_id,candidate_id,round,action,reviewer,reviewed_at,next_review_at,round_kind,effect,amends_decision_id FROM verdict_events").all().map(normalizeRow);
  const decisionRecords = db.query<Record<string, unknown>, []>("SELECT CAST(sequence AS TEXT) sequence,decision_record_id,idempotency_key,payload,payload_hash,created_at,received_at FROM decision_records").all().map(normalizeRow);
  const decisionFeedbackEvents = db.query<Record<string, unknown>, []>("SELECT CAST(sequence AS TEXT) sequence,feedback_id,decision_record_id,action,comment,reviewer,reviewed_at,amends_feedback_id FROM decision_feedback_events").all().map(normalizeRow);
  const snapshot = summarize({ candidates: read("candidates"), review_rounds: read("review_rounds"), verdict_events: verdictEvents, application_receipts: read("application_receipts"), field_guide_schema_migrations: read("field_guide_schema_migrations"), decision_records: decisionRecords, decision_feedback_events: decisionFeedbackEvents, decision_promotions: read("decision_promotions"), decision_promotion_records: read("decision_promotion_records") }, sqliteSequences(db));
  assertCanonicalDecisionUuids(snapshot);
  return snapshot;
}

export function assertCanonicalDecisionUuids(snapshot: LogicalSnapshot) {
  for (const row of snapshot.tables.decision_records) {
    const id = canonicalSnapshotUuid(row.decision_record_id, "decision_records.decision_record_id");
    const payload = row.payload as { decisionRecordId?: unknown } | undefined;
    if (payload?.decisionRecordId !== id)
      throw new Error("Decision record snapshot column and payload IDs must match canonically.");
  }
  for (const row of snapshot.tables.decision_feedback_events) {
    canonicalSnapshotUuid(row.feedback_id, "decision_feedback_events.feedback_id");
    canonicalSnapshotUuid(row.decision_record_id, "decision_feedback_events.decision_record_id");
    if (row.amends_feedback_id !== null)
      canonicalSnapshotUuid(row.amends_feedback_id, "decision_feedback_events.amends_feedback_id");
  }
  for (const row of snapshot.tables.decision_promotion_records)
    canonicalSnapshotUuid(row.decision_record_id, "decision_promotion_records.decision_record_id");
}

function canonicalSnapshotUuid(value: unknown, name: string) {
  const uuid = String(value);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid) ||
    uuid !== uuid.toLowerCase()
  ) throw new Error(`${name} must be a canonical UUID.`);
  return uuid;
}

export function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeValue(key, value)]));
}

function normalizeValue(key: string, value: unknown): unknown {
  if (value === null) return null;
  if (key === "payload") return typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (key === "sequence") return String(value);
  if (key === "adopted") return typeof value === "boolean" ? value : Number(value) === 1;
  if (TIMESTAMPS.has(key)) return canonicalTimestamp(String(value));
  return value;
}

function maximumSequence(rows: readonly Record<string, unknown>[]) {
  return String(rows.map((row) => BigInt(String(row.sequence))).reduce((left, right) => left > right ? left : right, 0n));
}

export function canonicalTimestamp(value: string): string {
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?Z$/.exec(value);
  if (!match) throw new Error(`Timestamp is not canonical UTC ISO-8601: ${value}`);
  return `${match[1]}.${(match[2] ?? "").padEnd(6, "0")}Z`;
}

export function apiTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Timestamp is invalid: ${value}`);
  return date.toISOString();
}

export function snapshotReport(snapshot: LogicalSnapshot): SnapshotReport {
  return {
    schema: 1,
    tables: Object.fromEntries(TABLES.map((name) => [name, { count: snapshot.counts[name], hash: snapshot.hashes[name] }])) as SnapshotReport["tables"],
    maxSequences: snapshot.maxSequences,
    sequences: snapshot.sequences,
  };
}

export function snapshotsEqual(left: LogicalSnapshot, right: LogicalSnapshot) {
  return TABLES.every((name) => left.counts[name] === right.counts[name] && left.hashes[name] === right.hashes[name])
    && SEQUENCED_TABLES.every((name) => left.maxSequences[name] === right.maxSequences[name] && left.sequences[name].nextValue === right.sequences[name].nextValue);
}
