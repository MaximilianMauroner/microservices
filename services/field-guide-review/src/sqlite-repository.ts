import crypto from "node:crypto";
import type { Database } from "bun:sqlite";
import { apiTimestamp, canonicalTimestamp } from "./db/logical-snapshot.js";
import {
  ConflictError,
  ValidationError,
  decodeCursor,
  encodeCursor,
  validateVerdict,
  type AmendVerdictInput,
  type Candidate,
  type Decision,
  type Effect,
  type QueueItem,
  type ReviewRepository,
  type RoundKind,
  type Scope,
  type Summary,
  type VerdictInput,
} from "./types.js";

type CandidateRow = { payload: string; payload_hash: string };
type RoundRow = { payload: string; kind: RoundKind; due_at: string | null; verdict_id: string | null };
type AmendRow = RoundRow & { action: Decision["action"] | null; next_review_at: string | null };
type ScopeRow = RoundRow & { event_count: number };
type EventRow = {
  sequence: string;
  decision_id: string;
  candidate_id: string;
  round: number;
  action: Decision["action"];
  round_kind: RoundKind;
  effect: Effect;
  amends_decision_id: string | null;
  is_current: number;
  can_amend: number;
  reviewed_at: string;
  next_review_at: string | null;
  reviewer: string;
  payload: string;
};

export class SQLiteReviewRepository implements ReviewRepository {
  constructor(private readonly db: Database, private readonly closeDatabase: () => void = () => db.close()) {}

  async createCandidate(key: string, candidate: Candidate) {
    return this.immediate(() => {
      const hash = digest(candidate);
      const old = this.db.query<CandidateRow, [string]>("SELECT payload,payload_hash FROM candidates WHERE idempotency_key=?").get(key);
      if (old) {
        if (old.payload_hash !== hash) throw new ConflictError("Idempotency key already has different content.");
        return "replay" as const;
      }
      try {
        this.db.query("INSERT INTO candidates(candidate_id,idempotency_key,payload,payload_hash,created_at) VALUES(?,?,?,?,?)").run(candidate.candidateId, key, canonical(candidate), hash, iso(candidate.createdAt));
        this.db.query("INSERT INTO review_rounds(candidate_id,round,kind) VALUES(?,1,'initial')").run(candidate.candidateId);
        return "created" as const;
      } catch (error) {
        if (isConstraint(error)) throw new ConflictError("Candidate already exists.");
        throw error;
      }
    });
  }

  async createReceipt(key: string, decisionId: string, appliedAt: string, result: "applied" | "already_applied") {
    return this.immediate(() => {
      const hash = digest({ decisionId, appliedAt, result });
      const old = this.db.query<{ payload_hash: string }, [string]>("SELECT payload_hash FROM application_receipts WHERE idempotency_key=?").get(key);
      if (old) {
        if (old.payload_hash !== hash) throw new ConflictError("Idempotency key already has different content.");
        return "replay" as const;
      }
      try {
        this.db.query("INSERT INTO application_receipts(idempotency_key,payload_hash,decision_id,applied_at,result) VALUES(?,?,?,?,?)").run(key, hash, decisionId, iso(appliedAt), result);
        return "created" as const;
      } catch (error) {
        if (isConstraint(error)) throw new ConflictError("Receipt conflict.");
        throw error;
      }
    });
  }

  async decisions(cursor: string | undefined, limit: number, scope?: Scope) {
    const after = decodeCursor(cursor) ?? "0";
    const rows = this.events("v.sequence>?", BigInt(after), limit, scope, "ASC");
    return { decisions: rows.map(toDecision), ...(rows.length ? { nextCursor: encodeCursor(String(rows.at(-1)?.sequence ?? after)) } : {}) };
  }

  async history(cursor: string | undefined, limit: number, scope?: Scope) {
    const before = decodeCursor(cursor);
    const rows = this.events(before ? "v.sequence<?" : "1=1", before ? BigInt(before) : undefined, limit + 1, scope, "DESC");
    const page = rows.slice(0, limit);
    return { decisions: page.map(toDecision), hasMore: rows.length > limit, ...(rows.length > limit ? { nextCursor: encodeCursor(String(page.at(-1)?.sequence ?? 0)) } : {}) };
  }

  async queue(scope: Scope | undefined, now: Date): Promise<QueueItem[]> {
    const rows = this.db.query<{ payload:string; round:number; kind:RoundKind; due_at:string|null }, [string | null, string, string]>(`
      SELECT c.payload,r.round,r.kind,r.due_at FROM candidates c
      JOIN review_rounds r ON r.candidate_id=c.candidate_id
      WHERE r.verdict_id IS NULL
        AND r.round=(SELECT MAX(rr.round) FROM review_rounds rr WHERE rr.candidate_id=c.candidate_id AND rr.verdict_id IS NULL)
        AND (? IS NULL OR json_extract(c.payload,'$.scope')=?)
        AND (r.due_at IS NULL OR r.due_at<=?)
      ORDER BY COALESCE(r.due_at,c.created_at),c.candidate_id
    `).all(scope ?? null, scope ?? "", internalTimestamp(now.toISOString()));
    const canonicalNow=internalTimestamp(now.toISOString());
    return rows.map((row) => ({ candidate: parseCandidate(row.payload), round:row.round, kind:row.kind, ...(row.due_at ? {dueAt:apiTimestamp(row.due_at)}:{}), status:!row.due_at ? "pending" : row.due_at < canonicalNow ? "overdue" : "due" }));
  }

  async decide(candidateId:string, round:number, input:VerdictInput, now:Date, reviewer:string) {
    return this.immediate(() => {
      const row = this.db.query<RoundRow, [string, number]>("SELECT c.payload,r.kind,r.due_at,r.verdict_id FROM candidates c JOIN review_rounds r USING(candidate_id) WHERE c.candidate_id=? AND r.round=?").get(candidateId, round);
      if (!row) throw new Error("Candidate not found.");
      if (row.verdict_id) throw new ConflictError("Review round is already decided.");
      if (row.due_at && row.due_at > internalTimestamp(now.toISOString())) throw new ConflictError("Review is not due yet.");
      return this.appendDecision(candidateId, round, row, input, now, reviewer);
    });
  }

  async reassignScope(candidateId:string, round:number, scope:Scope, now:Date, reviewer:string) {
    return this.immediate(() => {
      const row = this.db.query<ScopeRow, [string, number]>(`
        SELECT c.payload,r.kind,r.due_at,r.verdict_id,
          (SELECT COUNT(*) FROM verdict_events v WHERE v.candidate_id=c.candidate_id) event_count
        FROM candidates c JOIN review_rounds r USING(candidate_id)
        WHERE c.candidate_id=? AND r.round=?
      `).get(candidateId, round);
      if (!row) throw new Error("Candidate not found.");
      if (round !== 1 || row.kind !== "initial" || row.verdict_id || row.event_count)
        throw new ConflictError("Scope can only change before the initial review is decided.");
      const candidate=parseCandidate(row.payload);
      if(candidate.scope===scope)throw new ValidationError("Candidate already has this scope.");
      const foundProjectKey=candidate.foundProjectKey??candidate.projectKey;
      const foundProjectDisplayName=candidate.foundProjectDisplayName??candidate.projectDisplayName;
      if(scope==="project"&&(!foundProjectKey||!foundProjectDisplayName))throw new ValidationError("This candidate has no associated project to demote to.");
      const changed:Candidate={...candidate,scope,...(scope==="project"?{projectKey:foundProjectKey,projectDisplayName:foundProjectDisplayName}:{projectKey:undefined,projectDisplayName:undefined}),...(foundProjectKey&&foundProjectDisplayName?{foundProjectKey,foundProjectDisplayName}:{}),scopeChangedAt:now.toISOString(),scopeChangedBy:reviewer};
      this.db.query("UPDATE candidates SET payload=? WHERE candidate_id=?").run(canonical(changed),candidateId);
      return changed;
    });
  }

  async amendDecision(candidateId:string, round:number, input:AmendVerdictInput, now:Date, reviewer:string) {
    return this.immediate(() => {
      const row = this.db.query<AmendRow, [string, number]>("SELECT c.payload,r.kind,r.due_at,r.verdict_id,current.action,current.next_review_at FROM candidates c JOIN review_rounds r USING(candidate_id) LEFT JOIN verdict_events current ON current.decision_id=r.verdict_id WHERE c.candidate_id=? AND r.round=?").get(candidateId, round);
      if (!row) throw new Error("Candidate not found.");
      if (!row.verdict_id || !row.action) throw new ConflictError("Review round has no decision to amend.");
      if (row.verdict_id !== input.expectedDecisionId) throw new ConflictError("Decision changed since it was loaded. Refresh and try again.");
      const descendant = this.db.query<{ found:number }, [string, number]>("SELECT EXISTS(SELECT 1 FROM review_rounds WHERE candidate_id=? AND round>? AND verdict_id IS NOT NULL) found").get(candidateId, round);
      if (descendant?.found) throw new ConflictError("This decision cannot be amended after a later round was decided.");
      if (row.action === input.action && input.action !== "defer") throw new ValidationError("Choose a different verdict.");
      const schedule = validateVerdict(row.kind, input, now, this.confirmations(candidateId));
      if (input.action === "defer" && row.action === "defer" && schedule.nextReviewAt && internalTimestamp(schedule.nextReviewAt.toISOString()) === row.next_review_at) throw new ValidationError("Choose a different defer date.");
      this.db.query("DELETE FROM review_rounds WHERE candidate_id=? AND round=? AND verdict_id IS NULL").run(candidateId, round + 1);
      return this.appendDecision(candidateId, round, row, input, now, reviewer, row.verdict_id);
    });
  }

  async summary(now:Date): Promise<Summary> { const queue = await this.queue(undefined, now); return {pending:queue.filter(x=>x.status==="pending").length,due:queue.filter(x=>x.status==="due").length,overdue:queue.filter(x=>x.status==="overdue").length}; }
  async close() { this.closeDatabase(); }

  private immediate<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result=operation(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private confirmations(candidateId:string) {
    return this.db.query<{ count:number }, [string]>("SELECT COUNT(*) count FROM review_rounds r JOIN verdict_events v ON v.decision_id=r.verdict_id WHERE r.candidate_id=? AND v.action='confirm_valid'").get(candidateId)?.count ?? 0;
  }

  private appendDecision(candidateId:string, round:number, row:RoundRow, input:VerdictInput, now:Date, reviewer:string, amendsDecisionId?:string): Decision {
    const schedule=validateVerdict(row.kind,input,now,this.confirmations(candidateId));
    const decisionId=crypto.randomUUID();
    this.db.query("INSERT INTO verdict_events(decision_id,candidate_id,round,action,round_kind,effect,amends_decision_id,reviewer,reviewed_at,next_review_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(decisionId,candidateId,round,input.action,row.kind,schedule.effect,amendsDecisionId??null,reviewer,internalTimestamp(now.toISOString()),schedule.nextReviewAt?internalTimestamp(schedule.nextReviewAt.toISOString()):null);
    this.db.query("UPDATE review_rounds SET verdict_id=? WHERE candidate_id=? AND round=?").run(decisionId,candidateId,round);
    if(schedule.nextReviewAt&&schedule.nextRoundKind)this.db.query("INSERT INTO review_rounds(candidate_id,round,kind,due_at) VALUES(?,?,?,?)").run(candidateId,round+1,schedule.nextRoundKind,internalTimestamp(schedule.nextReviewAt.toISOString()));
    const candidate=parseCandidate(row.payload);
    return {decisionId,candidateId,round,action:input.action,roundKind:row.kind,effect:schedule.effect,...(amendsDecisionId?{amendsDecisionId}:{}),isCurrent:true,canAmend:true,scope:candidate.scope,...(candidate.scope==="project"?{projectKey:candidate.projectKey,projectDisplayName:candidate.projectDisplayName}:{}),...candidateOrigin(candidate),lessonKey:candidate.lessonKey,title:candidate.title,body:candidate.body,evidence:candidate.evidence,reviewedAt:now.toISOString(),reviewer,...(schedule.nextReviewAt?{nextReviewAt:schedule.nextReviewAt.toISOString()}: {})};
  }

  private events(predicate:string, cursor:bigint|undefined, limit:number, scope:Scope|undefined, direction:"ASC"|"DESC") {
    const parameters: Array<string|number|bigint|null> = [];
    if (cursor !== undefined) parameters.push(cursor);
    parameters.push(scope ?? null, scope ?? "", limit);
    return this.db.query<EventRow, Array<string|number|bigint|null>>(`SELECT CAST(v.sequence AS TEXT) sequence,v.decision_id,v.candidate_id,v.round,v.action,v.round_kind,v.effect,v.amends_decision_id,v.reviewer,v.reviewed_at,v.next_review_at,c.payload,(r.verdict_id=v.decision_id) is_current,((r.verdict_id=v.decision_id) AND NOT EXISTS(SELECT 1 FROM review_rounds later WHERE later.candidate_id=v.candidate_id AND later.round>v.round AND later.verdict_id IS NOT NULL)) can_amend FROM verdict_events v JOIN candidates c USING(candidate_id) JOIN review_rounds r ON r.candidate_id=v.candidate_id AND r.round=v.round WHERE ${predicate} AND (? IS NULL OR json_extract(c.payload,'$.scope')=?) ORDER BY v.sequence ${direction} LIMIT ?`).all(...parameters);
  }
}

const canonical=(value:object)=>JSON.stringify(value);
const digest=(value:object)=>crypto.createHash("sha256").update(canonical(value)).digest("hex");
const iso=(value:string)=>{const date=new Date(value);if(!Number.isFinite(date.getTime()))throw new ValidationError("Invalid timestamp.");return internalTimestamp(date.toISOString());};
const internalTimestamp=(value:string)=>canonicalTimestamp(value);
const parseCandidate=(value:string)=>JSON.parse(value) as Candidate;
const isConstraint=(error:unknown)=>error instanceof Error && /constraint|unique/i.test(error.message);
function toDecision(row:EventRow):Decision { const candidate=parseCandidate(row.payload); return {decisionId:row.decision_id,candidateId:row.candidate_id,round:row.round,action:row.action,roundKind:row.round_kind,effect:row.effect,...(row.amends_decision_id?{amendsDecisionId:row.amends_decision_id}:{}),isCurrent:Boolean(row.is_current),canAmend:Boolean(row.can_amend),scope:candidate.scope,...(candidate.scope==="project"?{projectKey:candidate.projectKey,projectDisplayName:candidate.projectDisplayName}:{}),...candidateOrigin(candidate),lessonKey:candidate.lessonKey,title:candidate.title,body:candidate.body,evidence:candidate.evidence,reviewedAt:apiTimestamp(row.reviewed_at),reviewer:row.reviewer,...(row.next_review_at?{nextReviewAt:apiTimestamp(row.next_review_at)}:{})}; }
function candidateOrigin(candidate:Candidate){const foundProjectKey=candidate.foundProjectKey??candidate.projectKey;const foundProjectDisplayName=candidate.foundProjectDisplayName??candidate.projectDisplayName;return foundProjectKey&&foundProjectDisplayName?{foundProjectKey,foundProjectDisplayName}:{};}
