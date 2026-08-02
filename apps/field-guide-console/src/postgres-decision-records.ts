import crypto from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
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
  payload: DecisionRecord;
  feedback_id: string | null;
  action: DecisionFeedback["action"] | null;
  comment: string | null;
  reviewer: string | null;
  reviewed_at: Date | null;
  amends_feedback_id: string | null;
  promotion_candidate_id: string | null;
};
type FeedbackRow = {
  feedback_id: string;
  decision_record_id: string;
  action: DecisionFeedback["action"];
  comment: string | null;
  reviewer: string;
  reviewed_at: Date;
  amends_feedback_id: string | null;
};

export class PostgresDecisionRecordStore {
  constructor(private readonly sql: Sql) {}

  async create(key: string, record: DecisionRecord) {
    const hash = digest(record);
    return this.sql.begin(async (tx) => {
      const old = await tx<{ payload_hash: string }[]>`SELECT payload_hash FROM decision_records WHERE idempotency_key=${key}`;
      if (old[0]) {
        if (old[0].payload_hash !== hash)
          throw new ConflictError("Idempotency key already has different content.");
        return "replay" as const;
      }
      const inserted = await tx<{ decision_record_id: string }[]>`
        INSERT INTO decision_records(decision_record_id,idempotency_key,payload,payload_hash,created_at,received_at)
        VALUES(${record.decisionRecordId},${key},${tx.json(record)},${hash},${record.createdAt},${new Date()})
        ON CONFLICT DO NOTHING RETURNING decision_record_id`;
      if (inserted[0]) return "created" as const;
      const raced = await tx<{ payload_hash: string }[]>`SELECT payload_hash FROM decision_records WHERE idempotency_key=${key}`;
      if (raced[0]?.payload_hash === hash) return "replay" as const;
      throw new ConflictError("Decision record already exists.");
    });
  }

  async page(filters: DecisionRecordFilters) {
    const before = decodeCursor(filters.cursor);
    const cutoff = new Date(filters.now.getTime() - filters.archiveAfterDays * 86_400_000);
    const rows = await this.sql<RecordRow[]>`
      SELECT d.sequence::text sequence,d.payload,
        f.feedback_id,f.action,f.comment,f.reviewer,f.reviewed_at,f.amends_feedback_id,
        pr.candidate_id promotion_candidate_id
      FROM decision_records d
      LEFT JOIN LATERAL (
        SELECT * FROM decision_feedback_events latest
        WHERE latest.decision_record_id=d.decision_record_id
        ORDER BY latest.sequence DESC LIMIT 1
      ) f ON true
      LEFT JOIN decision_promotion_records pr ON pr.decision_record_id=d.decision_record_id
      WHERE (${before ?? null}::bigint IS NULL OR d.sequence<${before ?? null})
        AND (${filters.projectKey ?? null}::text IS NULL OR d.payload->>'projectKey'=${filters.projectKey ?? null})
        AND (${filters.taskId ?? null}::text IS NULL OR d.payload->>'taskId'=${filters.taskId ?? null})
        AND (${filters.device ?? null}::text IS NULL OR d.payload->>'device'=${filters.device ?? null})
        AND (${filters.harness ?? null}::text IS NULL OR d.payload->>'harness'=${filters.harness ?? null})
        AND (${filters.skill ?? null}::text IS NULL OR d.payload->>'skill'=${filters.skill ?? null})
        AND (${filters.from ?? null}::timestamptz IS NULL OR d.created_at>=${filters.from ?? null})
        AND (${filters.to ?? null}::timestamptz IS NULL OR d.created_at<=${filters.to ?? null})
        AND (${filters.reviewState}='all' OR (${filters.reviewState}='reviewed' AND f.feedback_id IS NOT NULL) OR (${filters.reviewState}='unreviewed' AND f.feedback_id IS NULL))
        AND (${filters.includeArchived} OR f.feedback_id IS NULL OR f.reviewed_at>${cutoff})
      ORDER BY d.sequence DESC LIMIT ${filters.limit + 1}`;
    const page = rows.slice(0, filters.limit);
    const pendingRows = await this.sql<{ count: number }[]>`
      SELECT COUNT(*)::int count FROM decision_records d
      WHERE NOT EXISTS(SELECT 1 FROM decision_feedback_events f WHERE f.decision_record_id=d.decision_record_id)`;
    return {
      items: page.map((row) => this.itemFromRow(row, filters.now, [])),
      pending: pendingRows[0]?.count ?? 0,
      hasMore: rows.length > filters.limit,
      ...(rows.length > filters.limit
        ? { nextCursor: encodeCursor(page.at(-1)?.sequence ?? "0") }
        : {}),
    };
  }

  async get(id: string, now: Date) {
    const rows = await this.sql<RecordRow[]>`
      SELECT d.sequence::text sequence,d.payload,
        f.feedback_id,f.action,f.comment,f.reviewer,f.reviewed_at,f.amends_feedback_id,
        pr.candidate_id promotion_candidate_id
      FROM decision_records d
      LEFT JOIN LATERAL (SELECT * FROM decision_feedback_events WHERE decision_record_id=d.decision_record_id ORDER BY sequence DESC LIMIT 1) f ON true
      LEFT JOIN decision_promotion_records pr ON pr.decision_record_id=d.decision_record_id
      WHERE d.decision_record_id=${id}`;
    const row = rows[0];
    if (!row) throw new NotFoundError("Decision record not found.");
    const feedback = await this.sql<FeedbackRow[]>`
      SELECT feedback_id,decision_record_id,action,comment,reviewer,reviewed_at,amends_feedback_id
      FROM decision_feedback_events WHERE decision_record_id=${id} ORDER BY sequence ASC`;
    return this.itemFromRow(row, now, feedback.map(toFeedback));
  }

  async feedback(decisionRecordId: string, input: DecisionFeedbackInput, now: Date, reviewer: string) {
    return this.sql.begin(async (tx) => {
      const record = await tx<{ decision_record_id: string }[]>`SELECT decision_record_id FROM decision_records WHERE decision_record_id=${decisionRecordId} FOR UPDATE`;
      if (!record[0]) throw new NotFoundError("Decision record not found.");
      const rows = await tx<FeedbackRow[]>`
        SELECT feedback_id,decision_record_id,action,comment,reviewer,reviewed_at,amends_feedback_id
        FROM decision_feedback_events WHERE decision_record_id=${decisionRecordId} ORDER BY sequence DESC LIMIT 1`;
      const current = rows[0];
      if (input.expectedFeedbackId !== undefined && input.expectedFeedbackId !== current?.feedback_id)
        throw new ConflictError("Feedback changed since it was loaded. Refresh and try again.");
      if (current && input.expectedFeedbackId === undefined)
        throw new ConflictError("Feedback already exists. Amend the current feedback instead.");
      const feedbackId = crypto.randomUUID();
      await tx`INSERT INTO decision_feedback_events(feedback_id,decision_record_id,action,comment,reviewer,reviewed_at,amends_feedback_id) VALUES(${feedbackId},${decisionRecordId},${input.action},${input.comment ?? null},${reviewer},${now},${current?.feedback_id ?? null})`;
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

  async promote(key: string, ids: string[], candidate: Candidate, now: Date, reviewer: string) {
    const hash = digest({ decisionRecordIds: ids, candidate });
    try {
      return await this.sql.begin(async (tx) => {
        const old = await tx<{ candidate_id: string; payload_hash: string; promoted_at: Date; promoted_by: string }[]>`
          SELECT candidate_id,payload_hash,promoted_at,promoted_by FROM decision_promotions WHERE idempotency_key=${key}`;
        if (old[0]) {
          if (old[0].payload_hash !== hash)
            throw new ConflictError("Idempotency key already has different content.");
          return { status: "replay" as const, promotion: await this.promotion(tx, old[0].candidate_id, old[0].promoted_at, old[0].promoted_by) };
        }
        const records = await tx<{ decision_record_id: string; reviewed: boolean; promoted: boolean }[]>`
          SELECT d.decision_record_id,
            EXISTS(SELECT 1 FROM decision_feedback_events f WHERE f.decision_record_id=d.decision_record_id) reviewed,
            EXISTS(SELECT 1 FROM decision_promotion_records p WHERE p.decision_record_id=d.decision_record_id) promoted
          FROM decision_records d WHERE d.decision_record_id IN ${tx(ids)} FOR UPDATE`;
        if (records.length !== ids.length) throw new NotFoundError("Decision record not found.");
        if (records.some((record) => !record.reviewed))
          throw new ValidationError("Every promoted decision record must be reviewed.");
        if (records.some((record) => record.promoted))
          throw new ConflictError("Decision record has already been promoted.");
        const candidateInsert = await tx<{ candidate_id: string }[]>`
          INSERT INTO candidates(candidate_id,idempotency_key,payload,payload_hash,created_at)
          VALUES(${candidate.candidateId},${`promotion:${key}`},${tx.json(candidate)},${digest(candidate)},${candidate.createdAt})
          ON CONFLICT DO NOTHING RETURNING candidate_id`;
        if (!candidateInsert[0]) throw new ConflictError("Candidate already exists.");
        await tx`INSERT INTO review_rounds(candidate_id,round,kind) VALUES(${candidate.candidateId},1,'initial')`;
        await tx`INSERT INTO decision_promotions(candidate_id,idempotency_key,payload_hash,promoted_at,promoted_by) VALUES(${candidate.candidateId},${key},${hash},${now},${reviewer})`;
        for (const [ordinal, id] of ids.entries())
          await tx`INSERT INTO decision_promotion_records(candidate_id,decision_record_id,ordinal) VALUES(${candidate.candidateId},${id},${ordinal})`;
        return {
          status: "created" as const,
          promotion: { candidateId: candidate.candidateId, decisionRecordIds: ids, promotedAt: now.toISOString(), promotedBy: reviewer } satisfies DecisionPromotion,
        };
      });
    } catch (error) {
      if (isUnique(error)) throw new ConflictError("Candidate or decision record has already been promoted.");
      throw error;
    }
  }

  private itemFromRow(row: RecordRow, now: Date, history: DecisionFeedback[]): DecisionRecordItem {
    const currentFeedback = row.feedback_id && row.action && row.reviewer && row.reviewed_at
      ? toFeedback({ feedback_id: row.feedback_id, decision_record_id: row.payload.decisionRecordId, action: row.action, comment: row.comment, reviewer: row.reviewer, reviewed_at: row.reviewed_at, amends_feedback_id: row.amends_feedback_id })
      : undefined;
    return {
      record: row.payload,
      ...(currentFeedback ? { currentFeedback } : {}),
      feedbackHistory: history.length ? history : currentFeedback ? [currentFeedback] : [],
      ...(row.promotion_candidate_id ? { promotionCandidateId: row.promotion_candidate_id } : {}),
      archived: Boolean(currentFeedback && now.getTime() - new Date(currentFeedback.reviewedAt).getTime() >= 90 * 86_400_000),
    };
  }

  private async promotion(tx: TransactionSql, candidateId: string, promotedAt: Date, promotedBy: string): Promise<DecisionPromotion> {
    const ids = await tx<{ decision_record_id: string }[]>`SELECT decision_record_id FROM decision_promotion_records WHERE candidate_id=${candidateId} ORDER BY ordinal`;
    return { candidateId, decisionRecordIds: ids.map((row) => row.decision_record_id), promotedAt: promotedAt.toISOString(), promotedBy };
  }
}

const digest = (value: object) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const isUnique = (error: unknown) => typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
const toFeedback = (row: FeedbackRow): DecisionFeedback => ({
  feedbackId: row.feedback_id,
  decisionRecordId: row.decision_record_id,
  action: row.action,
  ...(row.comment ? { comment: row.comment } : {}),
  reviewer: row.reviewer,
  reviewedAt: row.reviewed_at.toISOString(),
  ...(row.amends_feedback_id ? { amendsFeedbackId: row.amends_feedback_id } : {}),
});
