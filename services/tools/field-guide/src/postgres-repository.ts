import crypto from "node:crypto";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { PostgresDecisionRecordStore } from "./postgres-decision-records.js";
import { planAmendment, planScopeReassignment, planVerdict } from "./candidate-lifecycle.js";
import {
  ConflictError,
  ValidationError,
  decodeCursor,
  encodeCursor,
  type AmendVerdictInput,
  type Candidate,
  type Decision,
  type DecisionFeedbackInput,
  type DecisionRecord,
  type DecisionRecordFilters,
  type Effect,
  type QueueItem,
  type ReviewRepository,
  type RoundKind,
  type Scope,
  type Summary,
  type VerdictInput,
} from "./types.js";
type CandidateRow = { payload: Candidate; payload_hash: string };
type EventRow = {
  sequence: string;
  decision_id: string;
  candidate_id: string;
  round: number;
  action: Decision["action"];
  round_kind: RoundKind;
  effect: Effect;
  amends_decision_id: string | null;
  is_current: boolean;
  can_amend: boolean;
  reviewed_at: Date;
  next_review_at: Date | null;
  reviewer: string;
  payload: Candidate;
};
export class PostgresReviewRepository implements ReviewRepository {
  private readonly sql: Sql;
  private readonly decisionRecordStore: PostgresDecisionRecordStore;
  constructor(url: string, options: { readOnly?: boolean } = {}) {
    this.sql = postgres(url, {
      max: 5,
      idle_timeout: 120,
      connection: {
        search_path: FIELD_GUIDE_SCHEMA,
        ...(options.readOnly ? { default_transaction_read_only: true } : {})
      },
    });
    this.decisionRecordStore = new PostgresDecisionRecordStore(this.sql);
  }
  async createCandidate(key: string, candidate: Candidate) {
    const hash = digest(candidate);
    return this.sql.begin(async (tx) => {
      const old = await tx<
        CandidateRow[]
      >`SELECT payload,payload_hash FROM candidates WHERE idempotency_key=${key}`;
      if (old[0]) {
        if (old[0].payload_hash !== hash)
          throw new ConflictError(
            "Idempotency key already has different content.",
          );
        return "replay" as const;
      }
      try {
        const inserted=await tx<{candidate_id:string}[]>`INSERT INTO candidates(candidate_id,idempotency_key,payload,payload_hash,created_at) VALUES(${candidate.candidateId},${key},${tx.json(candidate)},${hash},${candidate.createdAt}) ON CONFLICT DO NOTHING RETURNING candidate_id`;
        if(!inserted[0]){const raced=await tx<CandidateRow[]>`SELECT payload,payload_hash FROM candidates WHERE idempotency_key=${key}`;if(raced[0]?.payload_hash===hash)return "replay" as const;throw new ConflictError("Candidate already exists.");}
        await tx`INSERT INTO review_rounds(candidate_id,round,kind) VALUES(${candidate.candidateId},1,'initial')`;
        return "created" as const;
      } catch (error) {
        if (isUnique(error)) throw new ConflictError("Candidate already exists.");
        throw error;
      }
    });
  }
  async createReceipt(
    key: string,
    decisionId: string,
    appliedAt: string,
    result: "applied" | "already_applied",
  ) {
    const hash = digest({ decisionId, appliedAt, result });
    const old = await this.sql<
      { payload_hash: string }[]
    >`SELECT payload_hash FROM application_receipts WHERE idempotency_key=${key}`;
    if (old[0]) {
      if (old[0].payload_hash !== hash)
        throw new ConflictError(
          "Idempotency key already has different content.",
        );
      return "replay";
    }
    try {
      const inserted=await this.sql<{idempotency_key:string}[]>`INSERT INTO application_receipts VALUES(${key},${hash},${decisionId},${appliedAt},${result}) ON CONFLICT DO NOTHING RETURNING idempotency_key`;
      if(inserted[0])return "created";
      const raced=await this.sql<{payload_hash:string}[]>`SELECT payload_hash FROM application_receipts WHERE idempotency_key=${key}`;if(raced[0]?.payload_hash===hash)return "replay";throw new ConflictError("Receipt conflict.");
    } catch (error) {
      if (isUnique(error)) throw new ConflictError("Receipt conflict.");
      throw error;
    }
  }
  async decisions(cursor: string | undefined, limit: number, scope?: Scope) {
    const after = decodeCursor(cursor) ?? "0";
    const rows = await this.sql<
      EventRow[]
    >`${eventProjection(this.sql, scope)} AND v.sequence>${after} ORDER BY v.sequence ASC LIMIT ${limit}`;
    const page = rows.slice(0, limit);
    return {
      decisions: page.map(toDecision),
      ...(page.length
        ? { nextCursor: encodeCursor(page.at(-1)?.sequence ?? after) }
        : {}),
    };
  }
  async history(cursor:string|undefined,limit:number,scope?:Scope){const before=decodeCursor(cursor);const rows=await this.sql<EventRow[]>`${eventProjection(this.sql,scope)} AND (${before??null}::bigint IS NULL OR v.sequence<${before??null}) ORDER BY v.sequence DESC LIMIT ${limit+1}`;const page=rows.slice(0,limit);return{decisions:page.map(toDecision),hasMore:rows.length>limit,...(rows.length>limit?{nextCursor:encodeCursor(page.at(-1)?.sequence??"0")}:{})}}
  async queue(scope: Scope | undefined, now: Date): Promise<QueueItem[]> {
    const rows = await this.sql<
      {
        payload: Candidate;
        round: number;
        kind: "initial" | "scheduled";
        due_at: Date | null;
      }[]
    >`SELECT c.payload,r.round,r.kind,r.due_at FROM candidates c JOIN LATERAL (SELECT * FROM review_rounds rr WHERE rr.candidate_id=c.candidate_id AND rr.verdict_id IS NULL ORDER BY round DESC LIMIT 1) r ON true WHERE (${scope ?? null}::text IS NULL OR c.payload->>'scope'=${scope ?? null}) AND (r.due_at IS NULL OR r.due_at<=${now}) ORDER BY COALESCE(r.due_at,c.created_at),c.candidate_id`;
    return rows.map((r) => ({
      candidate: r.payload,
      round: r.round,
      kind: r.kind,
      ...(r.due_at ? { dueAt: r.due_at.toISOString() } : {}),
      status: !r.due_at ? "pending" : r.due_at < now ? "overdue" : "due",
    }));
  }
  async decide(
    candidateId: string,
    round: number,
    input: VerdictInput,
    now: Date,
    reviewer: string,
  ) {
    return this.sql.begin(async (tx) => {
      const rows = await tx<
        {
          payload: Candidate;
          kind: "initial" | "scheduled";
          due_at: Date | null;
          verdict_id: string | null;
        }[]
      >`SELECT c.payload,r.kind,r.due_at,r.verdict_id FROM candidates c JOIN review_rounds r USING(candidate_id) WHERE c.candidate_id=${candidateId} AND r.round=${round} FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new Error("Candidate not found.");
      if (row.verdict_id)
        throw new ConflictError("Review round is already decided.");
      if(row.due_at&&row.due_at>now)throw new ConflictError("Review is not due yet.");
      const confirmations=await authoritativeConfirmations(tx,candidateId);
      const schedule=planVerdict({kind:row.kind,input,now,confirmations});
      const id = crypto.randomUUID();
      await tx`INSERT INTO verdict_events(decision_id,candidate_id,round,action,round_kind,effect,reviewer,reviewed_at,next_review_at) VALUES(${id},${candidateId},${round},${input.action},${row.kind},${schedule.effect},${reviewer},${now},${schedule.nextReviewAt ?? null})`;
      await tx`UPDATE review_rounds SET verdict_id=${id} WHERE candidate_id=${candidateId} AND round=${round}`;
      if (schedule.nextReviewAt && schedule.nextRoundKind)
        await tx`INSERT INTO review_rounds(candidate_id,round,kind,due_at) VALUES(${candidateId},${round + 1},${schedule.nextRoundKind},${schedule.nextReviewAt})`;
      const c = row.payload;
      return {
        decisionId: id,
        candidateId,
        round,
        action: input.action,
        roundKind:row.kind,
        effect:schedule.effect,
        isCurrent:true,
        canAmend:true,
        scope: c.scope,
        ...(c.scope==="project"?{projectKey:c.projectKey,projectDisplayName:c.projectDisplayName}:{}),
        lessonKey: c.lessonKey,
        title: c.title,
        body: c.body,
        evidence:c.evidence,
        reviewedAt: now.toISOString(),
        reviewer,
        ...(schedule.nextReviewAt ? { nextReviewAt: schedule.nextReviewAt.toISOString() } : {}),
      };
    });
  }
  async reassignScope(
    candidateId: string,
    round: number,
    scope: Scope,
    now: Date,
    reviewer: string,
  ) {
    return this.sql.begin(async (tx) => {
      const rows = await tx<
        {
          payload: Candidate;
          kind: RoundKind;
          verdict_id: string | null;
          event_count: number;
        }[]
      >`SELECT c.payload,r.kind,r.verdict_id,
          (SELECT COUNT(*)::int FROM verdict_events v WHERE v.candidate_id=c.candidate_id) event_count
        FROM candidates c JOIN review_rounds r USING(candidate_id)
        WHERE c.candidate_id=${candidateId} AND r.round=${round}
        FOR UPDATE OF c,r`;
      const row = rows[0];
      if (!row) throw new Error("Candidate not found.");
      const candidate = row.payload;
      const changed = planScopeReassignment({ candidate, round, kind: row.kind, verdictId: row.verdict_id, hasEvents: Boolean(row.event_count), scope, now, reviewer });
      await tx`UPDATE candidates SET payload=${tx.json(changed)} WHERE candidate_id=${candidateId}`;
      return changed;
    });
  }
  async amendDecision(
    candidateId:string,
    round:number,
    input:AmendVerdictInput,
    now:Date,
    reviewer:string,
  ) {
    return this.sql.begin(async(tx)=>{
      const rows=await tx<{
        payload:Candidate;
        kind:RoundKind;
        verdict_id:string|null;
        action:Decision["action"]|null;
        next_review_at:Date|null;
      }[]>`SELECT c.payload,r.kind,r.verdict_id,current.action,current.next_review_at FROM candidates c JOIN review_rounds r USING(candidate_id) LEFT JOIN verdict_events current ON current.decision_id=r.verdict_id WHERE c.candidate_id=${candidateId} AND r.round=${round} FOR UPDATE OF c,r`;
      const row=rows[0];
      if(!row)throw new Error("Candidate not found.");
      const descendants=await tx<{exists:boolean}[]>`SELECT EXISTS(SELECT 1 FROM review_rounds WHERE candidate_id=${candidateId} AND round>${round} AND verdict_id IS NOT NULL) exists`;
      const confirmations=await authoritativeConfirmations(tx,candidateId);
      const { currentDecisionId, schedule }=planAmendment({kind:row.kind,input,now,confirmations,currentDecisionId:row.verdict_id,currentAction:row.action,currentNextReviewAt:row.next_review_at,hasDecidedDescendant:Boolean(descendants[0]?.exists)});
      await tx`DELETE FROM review_rounds WHERE candidate_id=${candidateId} AND round=${round+1} AND verdict_id IS NULL`;
      const decisionId=crypto.randomUUID();
      await tx`INSERT INTO verdict_events(decision_id,candidate_id,round,action,round_kind,effect,amends_decision_id,reviewer,reviewed_at,next_review_at) VALUES(${decisionId},${candidateId},${round},${input.action},${row.kind},${schedule.effect},${currentDecisionId},${reviewer},${now},${schedule.nextReviewAt??null})`;
      await tx`UPDATE review_rounds SET verdict_id=${decisionId} WHERE candidate_id=${candidateId} AND round=${round}`;
      if(schedule.nextReviewAt&&schedule.nextRoundKind)await tx`INSERT INTO review_rounds(candidate_id,round,kind,due_at) VALUES(${candidateId},${round+1},${schedule.nextRoundKind},${schedule.nextReviewAt})`;
      const candidate=row.payload;
      return{
        decisionId,
        candidateId,
        round,
        action:input.action,
        roundKind:row.kind,
        effect:schedule.effect,
        amendsDecisionId:currentDecisionId,
        isCurrent:true,
        canAmend:true,
        scope:candidate.scope,
        ...(candidate.scope==="project"?{projectKey:candidate.projectKey,projectDisplayName:candidate.projectDisplayName}:{}),
        lessonKey:candidate.lessonKey,
        title:candidate.title,
        body:candidate.body,
        evidence:candidate.evidence,
        reviewedAt:now.toISOString(),
        reviewer,
        ...(schedule.nextReviewAt?{nextReviewAt:schedule.nextReviewAt.toISOString()}:{}),
      } satisfies Decision;
    });
  }
  async summary(now: Date): Promise<Summary> {
    await this.sql`SELECT 1 FROM decision_records LIMIT 1`;
    const q = await this.queue(undefined, now);
    return {
      pending: q.filter((x) => x.status === "pending").length,
      due: q.filter((x) => x.status === "due").length,
      overdue: q.filter((x) => x.status === "overdue").length,
    };
  }
  async createDecisionRecord(key:string,record:DecisionRecord){return this.decisionRecordStore.create(key,record);}
  async decisionRecords(filters:DecisionRecordFilters){return this.decisionRecordStore.page(filters);}
  async decisionRecord(id:string,now:Date,archiveAfterDays:number){return this.decisionRecordStore.get(id,now,archiveAfterDays);}
  async addDecisionFeedback(id:string,input:DecisionFeedbackInput,now:Date,reviewer:string){return this.decisionRecordStore.feedback(id,input,now,reviewer);}
  async promoteDecisionRecords(key:string,ids:string[],candidate:Candidate,now:Date,reviewer:string){return this.decisionRecordStore.promote(key,ids,candidate,now,reviewer);}
  async close() {
    await this.sql.end();
  }
}
const FIELD_GUIDE_SCHEMA = "field_guide";
const digest = (value: object) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const isUnique = (e: unknown) =>
  typeof e === "object" &&
  e !== null &&
  "code" in e &&
  (e as { code?: unknown }).code === "23505";
function toDecision(r: EventRow): Decision {
  const c = r.payload;
  return {
    decisionId: r.decision_id,
    candidateId: r.candidate_id,
    round: r.round,
    action: r.action,
    roundKind:r.round_kind,
    effect:r.effect,
    ...(r.amends_decision_id?{amendsDecisionId:r.amends_decision_id}:{}),
    isCurrent:r.is_current,
    canAmend:r.can_amend,
    scope: c.scope,
    ...(c.scope==="project"?{projectKey:c.projectKey,projectDisplayName:c.projectDisplayName}:{}),
    lessonKey: c.lessonKey,
    title: c.title,
    body: c.body,
    evidence:c.evidence,
    reviewedAt: r.reviewed_at.toISOString(),
    reviewer:r.reviewer,
    ...(r.next_review_at
      ? { nextReviewAt: r.next_review_at.toISOString() }
      : {}),
  };
}

function eventProjection(sql:Sql,scope:Scope|undefined){
  return sql`SELECT v.sequence,v.decision_id,v.candidate_id,v.round,v.action,v.round_kind,v.effect,v.amends_decision_id,v.reviewer,v.reviewed_at,v.next_review_at,c.payload,(r.verdict_id=v.decision_id) is_current,((r.verdict_id=v.decision_id) AND NOT EXISTS(SELECT 1 FROM review_rounds later WHERE later.candidate_id=v.candidate_id AND later.round>v.round AND later.verdict_id IS NOT NULL)) can_amend FROM verdict_events v JOIN candidates c USING(candidate_id) JOIN review_rounds r ON r.candidate_id=v.candidate_id AND r.round=v.round WHERE (${scope??null}::text IS NULL OR c.payload->>'scope'=${scope??null})`;
}

async function authoritativeConfirmations(sql:TransactionSql,candidateId:string){
  const rows=await sql<{count:number}[]>`SELECT COUNT(*)::int count FROM review_rounds r JOIN verdict_events v ON v.decision_id=r.verdict_id WHERE r.candidate_id=${candidateId} AND v.action='confirm_valid'`;
  return rows[0]?.count??0;
}
