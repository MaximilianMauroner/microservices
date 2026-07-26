import crypto from "node:crypto";
import {
  addDays,
  ConflictError,
  type Candidate,
  type Decision,
  type QueueItem,
  type ReviewRepository,
  type Scope,
  type VerdictInput,
} from "./types.js";
type State = {
  candidate: Candidate;
  round: number;
  kind: "initial" | "scheduled";
  dueAt?: string;
  closed: boolean;
  confirmations: number;
};
export class MemoryReviewRepository implements ReviewRepository {
  private candidates = new Map<string, State>();
  private keys = new Map<string, string>();
  private events: Decision[] = [];
  private receipts = new Map<string, string>();
  async createCandidate(k: string, c: Candidate) {
    const j = JSON.stringify(c),
      old = this.keys.get(k);
    if (old) {
      if (old !== j)
        throw new ConflictError(
          "Idempotency key already has different content.",
        );
      return "replay";
    }
    if (this.candidates.has(c.candidateId))
      throw new ConflictError("Candidate already exists.");
    this.keys.set(k, j);
    this.candidates.set(c.candidateId, {
      candidate: c,
      round: 1,
      kind: "initial",
      closed: false,
      confirmations: 0,
    });
    return "created";
  }
  async createReceipt(
    k: string,
    id: string,
    at: string,
    result: "applied" | "already_applied",
  ) {
    if (!this.events.some((e) => e.decisionId === id))
      throw new Error("Decision not found.");
    const j = JSON.stringify({ id, at, result }),
      old = this.receipts.get(k);
    if (old) {
      if (old !== j)
        throw new ConflictError(
          "Idempotency key already has different content.",
        );
      return "replay";
    }
    this.receipts.set(k, j);
    return "created";
  }
  async decisions(cursor: string | undefined, limit: number, scope?: Scope) {
    let offset = cursor
      ? Number(Buffer.from(cursor, "base64url").toString())
      : 0;
    if (!Number.isInteger(offset) || offset < 0)
      throw new Error("Invalid cursor.");
    const filtered = this.events.filter((e) => !scope || e.scope === scope),
      decisions = filtered.slice(offset, offset + limit),
      next = offset + decisions.length;
    return {
      decisions,
      ...(decisions.length
        ? { nextCursor: Buffer.from(String(next)).toString("base64url") }
        : {}),
    };
  }
  async history(cursor:string|undefined,limit:number,scope?:Scope){let offset=cursor?Number(Buffer.from(cursor,"base64url").toString()):0;if(!Number.isInteger(offset)||offset<0)throw new Error("Invalid cursor.");const filtered=this.events.filter(e=>!scope||e.scope===scope),rows=filtered.slice(offset,offset+limit+1),decisions=rows.slice(0,limit),next=offset+decisions.length;return{decisions,hasMore:rows.length>limit,...(rows.length>limit?{nextCursor:Buffer.from(String(next)).toString("base64url")}:{})}}
  async queue(scope: Scope | undefined, now: Date) {
    return [...this.candidates.values()]
      .filter(
        (s) =>
          !s.closed &&
          (!scope || s.candidate.scope === scope) &&
          (!s.dueAt || new Date(s.dueAt) <= now),
      )
      .map((s) => item(s, now));
  }
  async decide(
    id: string,
    round: number,
    input: VerdictInput,
    now: Date,
    reviewer: string,
  ) {
    const s = this.candidates.get(id);
    if (!s) throw new Error("Candidate not found.");
    if (s.closed || s.round !== round)
      throw new ConflictError("Review round is already decided.");
    if (s.dueAt && new Date(s.dueAt) > now)
      throw new ConflictError("Review is not due yet.");
    const allowed =
      s.kind === "initial"
        ? ["approve", "reject", "defer"]
        : ["confirm_valid", "mark_invalid", "defer"];
    if (!allowed.includes(input.action))
      throw new Error("Action is not valid for this review round.");
    let next: Date | undefined;
    if (input.action === "defer") {
      next = new Date(input.deferUntil ?? "");
      if (
        !Number.isFinite(next.getTime()) ||
        next <= now ||
        next > addDays(now, 90)
      )
        throw new Error("deferUntil must be within the next 90 days.");
    } else if (input.action === "approve") {
      next = addDays(now, 7);
      s.kind = "scheduled";
    } else if (input.action === "confirm_valid") {
      s.confirmations++;
      next = addDays(now, s.confirmations === 1 ? 30 : 90);
    } else s.closed = true;
    if (next) {
      s.round++;
      s.dueAt = next.toISOString();
    }
    const c = s.candidate,
      d: Decision = {
        decisionId: crypto.randomUUID(),
        candidateId: id,
        round,
        action: input.action,
      scope: c.scope,
      ...(c.scope==="project"?{projectKey:c.projectKey,projectDisplayName:c.projectDisplayName}:{}),
        lessonKey: c.lessonKey,
        title: c.title,
        body: c.body,
        evidence: c.evidence,
        reviewedAt: now.toISOString(),
        reviewer,
        ...(next ? { nextReviewAt: next.toISOString() } : {}),
      };
    this.events.push(d);
    return d;
  }
  async summary(now: Date) {
    const q = await this.queue(undefined, now);
    return {
      pending: q.filter((x) => x.status === "pending").length,
      due: q.filter((x) => x.status === "due").length,
      overdue: q.filter((x) => x.status === "overdue").length,
    };
  }
  async migrate() {}
  async close() {}
}
function item(s: State, now: Date): QueueItem {
  const status = !s.dueAt
    ? "pending"
    : new Date(s.dueAt) < now
      ? "overdue"
      : "due";
  return {
    candidate: s.candidate,
    round: s.round,
    kind: s.kind,
    ...(s.dueAt ? { dueAt: s.dueAt } : {}),
    status,
  };
}
