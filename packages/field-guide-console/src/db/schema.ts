import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import type { Candidate, DecisionRecord } from "../types.js";

function verdictDecisionId(): AnySQLiteColumn {
  return verdictEvents.decisionId;
}

export const candidates = sqliteTable("candidates", {
  candidateId: text("candidate_id").primaryKey(),
  idempotencyKey: text("idempotency_key")
    .notNull()
    .unique("candidates_idempotency_key_key"),
  payload: text("payload", { mode: "json" }).$type<Candidate>().notNull(),
  payloadHash: text("payload_hash").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [check("candidates_payload_json_check", sql`json_valid(${table.payload})`)]);

export const reviewRounds = sqliteTable(
  "review_rounds",
  {
    candidateId: text("candidate_id").notNull(),
    round: integer("round").notNull(),
    kind: text("kind").notNull(),
    dueAt: text("due_at"),
    verdictId: text("verdict_id")
      .unique("review_rounds_verdict_id_key"),
  },
  (table) => [
    primaryKey({
      name: "review_rounds_pkey",
      columns: [table.candidateId, table.round],
    }),
    foreignKey({
      name: "review_rounds_candidate_id_fkey",
      columns: [table.candidateId],
      foreignColumns: [candidates.candidateId],
    }),
    foreignKey({
      name: "review_rounds_verdict_id_fkey",
      columns: [table.verdictId],
      foreignColumns: [verdictDecisionId()],
    }),
    check(
      "review_rounds_kind_check",
      sql`${table.kind} in ('initial', 'scheduled')`,
    ),
  ],
);

export const verdictEvents = sqliteTable(
  "verdict_events",
  {
    sequence: integer("sequence").primaryKey({ autoIncrement: true }),
    decisionId: text("decision_id")
      .notNull()
      .unique("verdict_events_decision_id_key"),
    candidateId: text("candidate_id").notNull(),
    round: integer("round").notNull(),
    action: text("action").notNull(),
    reviewer: text("reviewer").notNull(),
    reviewedAt: text("reviewed_at").notNull(),
    nextReviewAt: text("next_review_at"),
    roundKind: text("round_kind").notNull(),
    effect: text("effect").notNull(),
    amendsDecisionId: text("amends_decision_id"),
  },
  (table) => [
    foreignKey({
      name: "verdict_events_candidate_id_round_fkey",
      columns: [table.candidateId, table.round],
      foreignColumns: [reviewRounds.candidateId, reviewRounds.round],
    }),
    foreignKey({
      name: "verdict_events_amends_decision_id_fkey",
      columns: [table.amendsDecisionId],
      foreignColumns: [table.decisionId],
    }),
    check(
      "verdict_events_round_kind_check",
      sql`${table.roundKind} in ('initial', 'scheduled')`,
    ),
    check(
      "verdict_events_effect_check",
      sql`${table.effect} in ('activate', 'deactivate')`,
    ),
    uniqueIndex("verdict_events_one_amendment_per_parent")
      .on(table.amendsDecisionId)
      .where(sql`${table.amendsDecisionId} is not null`),
  ],
);

export const applicationReceipts = sqliteTable(
  "application_receipts",
  {
    idempotencyKey: text("idempotency_key").primaryKey(),
    payloadHash: text("payload_hash").notNull(),
    decisionId: text("decision_id").notNull(),
    appliedAt: text("applied_at").notNull(),
    result: text("result").notNull(),
  },
  (table) => [
    foreignKey({
      name: "application_receipts_decision_id_fkey",
      columns: [table.decisionId],
      foreignColumns: [verdictEvents.decisionId],
    }),
    check(
      "application_receipts_result_check",
      sql`${table.result} in ('applied', 'already_applied')`,
    ),
  ],
);

export const fieldGuideSchemaMigrations = sqliteTable(
  "field_guide_schema_migrations",
  {
    name: text("name").primaryKey(),
    checksum: text("checksum").notNull(),
    appliedAt: text("applied_at").notNull(),
    adopted: integer("adopted", { mode: "boolean" }).notNull(),
  },
  (table) => [
    check("field_guide_schema_migrations_adopted_check", sql`${table.adopted} in (0, 1)`),
  ],
);

export const decisionRecords = sqliteTable("decision_records", {
  sequence: integer("sequence").primaryKey({ autoIncrement: true }),
  decisionRecordId: text("decision_record_id").notNull().unique("decision_records_record_id_key"),
  idempotencyKey: text("idempotency_key").notNull().unique("decision_records_idempotency_key_key"),
  payload: text("payload", { mode: "json" }).$type<DecisionRecord>().notNull(),
  payloadHash: text("payload_hash").notNull(),
  createdAt: text("created_at").notNull(),
  receivedAt: text("received_at").notNull(),
}, (table) => [check("decision_records_payload_json_check", sql`json_valid(${table.payload})`)]);

export const decisionFeedbackEvents = sqliteTable("decision_feedback_events", {
  sequence: integer("sequence").primaryKey({ autoIncrement: true }),
  feedbackId: text("feedback_id").notNull().unique("decision_feedback_events_feedback_id_key"),
  decisionRecordId: text("decision_record_id").notNull(),
  action: text("action").notNull(),
  comment: text("comment"),
  reviewer: text("reviewer").notNull(),
  reviewedAt: text("reviewed_at").notNull(),
  amendsFeedbackId: text("amends_feedback_id").unique("decision_feedback_events_amends_key"),
}, (table) => [
  foreignKey({ name: "decision_feedback_events_record_fkey", columns: [table.decisionRecordId], foreignColumns: [decisionRecords.decisionRecordId] }),
  foreignKey({ name: "decision_feedback_events_amends_fkey", columns: [table.amendsFeedbackId], foreignColumns: [table.feedbackId] }),
  check("decision_feedback_events_action_check", sql`${table.action} in ('up', 'down', 'dismiss')`),
  index("decision_feedback_events_record_sequence_idx").on(table.decisionRecordId, sql`${table.sequence} desc`),
]);

export const decisionPromotions = sqliteTable("decision_promotions", {
  candidateId: text("candidate_id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull().unique("decision_promotions_idempotency_key_key"),
  payloadHash: text("payload_hash").notNull(),
  promotedAt: text("promoted_at").notNull(),
  promotedBy: text("promoted_by").notNull(),
}, (table) => [
  foreignKey({ name: "decision_promotions_candidate_fkey", columns: [table.candidateId], foreignColumns: [candidates.candidateId] }),
]);

export const decisionPromotionRecords = sqliteTable("decision_promotion_records", {
  candidateId: text("candidate_id").notNull(),
  decisionRecordId: text("decision_record_id").notNull().unique("decision_promotion_records_record_key"),
  ordinal: integer("ordinal").notNull(),
}, (table) => [
  primaryKey({ name: "decision_promotion_records_pkey", columns: [table.candidateId, table.decisionRecordId] }),
  foreignKey({ name: "decision_promotion_records_candidate_fkey", columns: [table.candidateId], foreignColumns: [decisionPromotions.candidateId] }),
  foreignKey({ name: "decision_promotion_records_record_fkey", columns: [table.decisionRecordId], foreignColumns: [decisionRecords.decisionRecordId] }),
]);
