import crypto from "node:crypto";
import type { Database } from "bun:sqlite";
import { apiTimestamp, canonicalTimestamp } from "./db/logical-snapshot.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  decodeCursor,
  encodeCursor,
  type Candidate,
  type DecisionFeedback,
  type DecisionFeedbackInput,
  type DecisionPromotion,
  type DecisionRecord,
  type DecisionRecordFilters,
  type DecisionRecordItem,
} from "./types.js";

type RecordRow = {
  sequence: string;
  payload: string;
  feedback_id: string | null;
  action: DecisionFeedback["action"] | null;
  comment: string | null;
  reviewer: string | null;
  reviewed_at: string | null;
  amends_feedback_id: string | null;
  promotion_candidate_id: string | null;
};
type FeedbackRow = {
  feedback_id: string;
  decision_record_id: string;
  action: DecisionFeedback["action"];
  comment: string | null;
  reviewer: string;
  reviewed_at: string;
  amends_feedback_id: string | null;
};

export class SQLiteDecisionRecordStore {
  constructor(private readonly db: Database) {}

  create(key: string, record: DecisionRecord) {
    return this.immediate(() => {
      const hash = digest(record);
      const old = this.db.query<{ payload_hash: string }, [string]>(
        "SELECT payload_hash FROM decision_records WHERE idempotency_key=?",
      ).get(key);
      if (old) {
        if (old.payload_hash !== hash)
          throw new ConflictError("Idempotency key already has different content.");
        return "replay" as const;
      }
      try {
        const now = canonicalTimestamp(new Date().toISOString());
        this.db.query("INSERT INTO decision_records(decision_record_id,idempotency_key,payload,payload_hash,created_at,received_at) VALUES(?,?,?,?,?,?)")
          .run(record.decisionRecordId, key, canonical(record), hash, canonicalTimestamp(record.createdAt), now);
        return "created" as const;
      } catch (error) {
        if (isConstraint(error)) throw new ConflictError("Decision record already exists.");
        throw error;
      }
    });
  }

  page(filters: DecisionRecordFilters) {
    const where: string[] = [];
    const parameters: Array<string | number | bigint> = [];
    const before = decodeCursor(filters.cursor);
    if (before) { where.push("d.sequence < ?"); parameters.push(BigInt(before)); }
    if (filters.projectKey) {
      where.push("COALESCE(json_extract(d.payload,'$.foundProjectKey'),json_extract(d.payload,'$.projectKey')) = ?");
      parameters.push(filters.projectKey);
    }
    for (const [field, value] of [
      ["taskId", filters.taskId],
      ["device", filters.device],
      ["harness", filters.harness],
      ["skill", filters.skill],
    ] as const) {
      if (value) { where.push(`json_extract(d.payload,'$.${field}') = ?`); parameters.push(value); }
    }
    if (filters.from) { where.push("d.created_at >= ?"); parameters.push(canonicalTimestamp(filters.from)); }
    if (filters.to) { where.push("d.created_at <= ?"); parameters.push(canonicalTimestamp(filters.to)); }
    if (filters.reviewState === "unreviewed") where.push("f.feedback_id IS NULL");
    if (filters.reviewState === "reviewed") where.push("f.feedback_id IS NOT NULL");
    if (!filters.includeArchived) {
      where.push("(f.feedback_id IS NULL OR f.reviewed_at > ?)");
      parameters.push(canonicalTimestamp(new Date(filters.now.getTime() - filters.archiveAfterDays * 86_400_000).toISOString()));
    }
    parameters.push(filters.limit + 1);
    const rows = this.db.query<RecordRow, Array<string | number | bigint>>(`
      SELECT CAST(d.sequence AS TEXT) sequence,d.payload,
        f.feedback_id,f.action,f.comment,f.reviewer,f.reviewed_at,f.amends_feedback_id,
        pr.candidate_id promotion_candidate_id
      FROM decision_records d
      LEFT JOIN decision_feedback_events f ON f.feedback_id=(
        SELECT latest.feedback_id FROM decision_feedback_events latest
        WHERE latest.decision_record_id=d.decision_record_id
        ORDER BY latest.sequence DESC LIMIT 1
      )
      LEFT JOIN decision_promotion_records pr ON pr.decision_record_id=d.decision_record_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY d.sequence DESC
      LIMIT ?
    `).all(...parameters);
    const page = rows.slice(0, filters.limit);
    const pending = this.db.query<{ count: number }, []>(
      "SELECT COUNT(*) count FROM decision_records d WHERE NOT EXISTS(SELECT 1 FROM decision_feedback_events f WHERE f.decision_record_id=d.decision_record_id)",
    ).get()?.count ?? 0;
    return {
      items: page.map((row) => this.itemFromRow(row, filters.now, filters.archiveAfterDays, false)),
      pending,
      hasMore: rows.length > filters.limit,
      ...(rows.length > filters.limit
        ? { nextCursor: encodeCursor(page.at(-1)?.sequence ?? "0") }
        : {}),
    };
  }

  get(id: string, now: Date, archiveAfterDays: number) {
    const row = this.recordRow(id);
    if (!row) throw new NotFoundError("Decision record not found.");
    return this.itemFromRow(row, now, archiveAfterDays, true);
  }

  feedback(decisionRecordId: string, input: DecisionFeedbackInput, now: Date, reviewer: string) {
    return this.immediate(() => {
      if (!this.db.query("SELECT 1 FROM decision_records WHERE decision_record_id=?").get(decisionRecordId))
        throw new NotFoundError("Decision record not found.");
      const current = this.latestFeedback(decisionRecordId);
      if (input.expectedFeedbackId !== undefined && input.expectedFeedbackId !== current?.feedback_id)
        throw new ConflictError("Feedback changed since it was loaded. Refresh and try again.");
      if (current && input.expectedFeedbackId === undefined)
        throw new ConflictError("Feedback already exists. Amend the current feedback instead.");
      const feedbackId = crypto.randomUUID();
      this.db.query("INSERT INTO decision_feedback_events(feedback_id,decision_record_id,action,comment,reviewer,reviewed_at,amends_feedback_id) VALUES(?,?,?,?,?,?,?)")
        .run(feedbackId, decisionRecordId, input.action, input.comment ?? null, reviewer, canonicalTimestamp(now.toISOString()), current?.feedback_id ?? null);
      return {
        feedbackId,
        decisionRecordId,
        action: input.action,
        ...(input.comment ? { comment: input.comment } : {}),
        reviewer,
        reviewedAt: now.toISOString(),
        ...(current ? { amendsFeedbackId: current.feedback_id } : {}),
      } satisfies DecisionFeedback;
    });
  }

  promote(key: string, ids: string[], candidate: Candidate, now: Date, reviewer: string) {
    return this.immediate(() => {
      const hash = digest({ decisionRecordIds: ids, candidate });
      const old = this.db.query<{ candidate_id: string; payload_hash: string; promoted_at: string; promoted_by: string }, [string]>(
        "SELECT candidate_id,payload_hash,promoted_at,promoted_by FROM decision_promotions WHERE idempotency_key=?",
      ).get(key);
      if (old) {
        if (old.payload_hash !== hash)
          throw new ConflictError("Idempotency key already has different content.");
        return {
          status: "replay" as const,
          promotion: this.promotion(old.candidate_id, old.promoted_at, old.promoted_by),
        };
      }
      for (const id of ids) {
        if (!this.db.query("SELECT 1 FROM decision_records WHERE decision_record_id=?").get(id))
          throw new NotFoundError("Decision record not found.");
        if (!this.latestFeedback(id))
          throw new ValidationError("Every promoted decision record must be reviewed.");
        if (this.db.query("SELECT 1 FROM decision_promotion_records WHERE decision_record_id=?").get(id))
          throw new ConflictError("Decision record has already been promoted.");
      }
      try {
        this.db.query("INSERT INTO candidates(candidate_id,idempotency_key,payload,payload_hash,created_at) VALUES(?,?,?,?,?)")
          .run(candidate.candidateId, `promotion:${key}`, canonical(candidate), digest(candidate), canonicalTimestamp(candidate.createdAt));
        this.db.query("INSERT INTO review_rounds(candidate_id,round,kind) VALUES(?,1,'initial')").run(candidate.candidateId);
        this.db.query("INSERT INTO decision_promotions(candidate_id,idempotency_key,payload_hash,promoted_at,promoted_by) VALUES(?,?,?,?,?)")
          .run(candidate.candidateId, key, hash, canonicalTimestamp(now.toISOString()), reviewer);
        ids.forEach((id, ordinal) => this.db.query("INSERT INTO decision_promotion_records(candidate_id,decision_record_id,ordinal) VALUES(?,?,?)").run(candidate.candidateId, id, ordinal));
      } catch (error) {
        if (isConstraint(error)) throw new ConflictError("Candidate or decision record has already been promoted.");
        throw error;
      }
      return {
        status: "created" as const,
        promotion: {
          candidateId: candidate.candidateId,
          decisionRecordIds: ids,
          promotedAt: now.toISOString(),
          promotedBy: reviewer,
        } satisfies DecisionPromotion,
      };
    });
  }

  private recordRow(id: string) {
    return this.db.query<RecordRow, [string]>(`
      SELECT CAST(d.sequence AS TEXT) sequence,d.payload,
        f.feedback_id,f.action,f.comment,f.reviewer,f.reviewed_at,f.amends_feedback_id,
        pr.candidate_id promotion_candidate_id
      FROM decision_records d
      LEFT JOIN decision_feedback_events f ON f.feedback_id=(SELECT feedback_id FROM decision_feedback_events WHERE decision_record_id=d.decision_record_id ORDER BY sequence DESC LIMIT 1)
      LEFT JOIN decision_promotion_records pr ON pr.decision_record_id=d.decision_record_id
      WHERE d.decision_record_id=?
    `).get(id);
  }

  private itemFromRow(row: RecordRow, now: Date, archiveAfterDays: number, fullHistory: boolean): DecisionRecordItem {
    const record = JSON.parse(row.payload) as DecisionRecord;
    const currentFeedback = row.feedback_id && row.action && row.reviewer && row.reviewed_at
      ? toFeedback({
          feedback_id: row.feedback_id,
          decision_record_id: record.decisionRecordId,
          action: row.action,
          comment: row.comment,
          reviewer: row.reviewer,
          reviewed_at: row.reviewed_at,
          amends_feedback_id: row.amends_feedback_id,
        })
      : undefined;
    const feedbackHistory = fullHistory
      ? this.db.query<FeedbackRow, [string]>("SELECT feedback_id,decision_record_id,action,comment,reviewer,reviewed_at,amends_feedback_id FROM decision_feedback_events WHERE decision_record_id=? ORDER BY sequence ASC").all(record.decisionRecordId).map(toFeedback)
      : currentFeedback ? [currentFeedback] : [];
    return {
      record,
      ...(currentFeedback ? { currentFeedback } : {}),
      feedbackHistory,
      ...(row.promotion_candidate_id ? { promotionCandidateId: row.promotion_candidate_id } : {}),
      archived: Boolean(currentFeedback && now.getTime() - new Date(currentFeedback.reviewedAt).getTime() >= archiveAfterDays * 86_400_000),
    };
  }

  private latestFeedback(id: string) {
    return this.db.query<FeedbackRow, [string]>("SELECT feedback_id,decision_record_id,action,comment,reviewer,reviewed_at,amends_feedback_id FROM decision_feedback_events WHERE decision_record_id=? ORDER BY sequence DESC LIMIT 1").get(id);
  }

  private promotion(candidateId: string, promotedAt: string, promotedBy: string): DecisionPromotion {
    const ids = this.db.query<{ decision_record_id: string }, [string]>("SELECT decision_record_id FROM decision_promotion_records WHERE candidate_id=? ORDER BY ordinal").all(candidateId);
    return { candidateId, decisionRecordIds: ids.map((row) => row.decision_record_id), promotedAt: apiTimestamp(promotedAt), promotedBy };
  }

  private immediate<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}

const canonical = (value: object) => JSON.stringify(value);
const digest = (value: object) => crypto.createHash("sha256").update(canonical(value)).digest("hex");
const isConstraint = (error: unknown) => error instanceof Error && /constraint|unique/i.test(error.message);
const toFeedback = (row: FeedbackRow): DecisionFeedback => ({
  feedbackId: row.feedback_id,
  decisionRecordId: row.decision_record_id,
  action: row.action,
  ...(row.comment ? { comment: row.comment } : {}),
  reviewer: row.reviewer,
  reviewedAt: apiTimestamp(row.reviewed_at),
  ...(row.amends_feedback_id ? { amendsFeedbackId: row.amends_feedback_id } : {}),
});
