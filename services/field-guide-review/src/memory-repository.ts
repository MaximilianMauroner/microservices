import crypto from "node:crypto";
import {
  ConflictError,
  ValidationError,
  validateVerdict,
  type AmendVerdictInput,
  type Candidate,
  type Decision,
  type QueueItem,
  type ReviewRepository,
  type RoundKind,
  type Scope,
  type VerdictInput,
} from "./types.js";

type Round = {
  kind: RoundKind;
  dueAt?: string;
  verdictId?: string;
};
type CandidateState = {
  candidate: Candidate;
  rounds: Map<number, Round>;
};

export class MemoryReviewRepository implements ReviewRepository {
  private candidates = new Map<string, CandidateState>();
  private keys = new Map<string, string>();
  private events: Decision[] = [];
  private receipts = new Map<string, string>();

  async createCandidate(key: string, candidate: Candidate) {
    const serialized = JSON.stringify(candidate);
    const existing = this.keys.get(key);
    if (existing) {
      if (existing !== serialized)
        throw new ConflictError(
          "Idempotency key already has different content.",
        );
      return "replay" as const;
    }
    if (this.candidates.has(candidate.candidateId))
      throw new ConflictError("Candidate already exists.");
    this.keys.set(key, serialized);
    this.candidates.set(candidate.candidateId, {
      candidate,
      rounds: new Map([[1, { kind: "initial" }]]),
    });
    return "created" as const;
  }

  async createReceipt(
    key: string,
    decisionId: string,
    appliedAt: string,
    result: "applied" | "already_applied",
  ) {
    if (!this.events.some((event) => event.decisionId === decisionId))
      throw new Error("Decision not found.");
    const serialized = JSON.stringify({ decisionId, appliedAt, result });
    const existing = this.receipts.get(key);
    if (existing) {
      if (existing !== serialized)
        throw new ConflictError(
          "Idempotency key already has different content.",
        );
      return "replay" as const;
    }
    this.receipts.set(key, serialized);
    return "created" as const;
  }

  async decisions(cursor: string | undefined, limit: number, scope?: Scope) {
    const offset = decodeCursor(cursor);
    const filtered = this.projectedEvents().filter(
      (event) => !scope || event.scope === scope,
    );
    const decisions = filtered.slice(offset, offset + limit);
    const next = offset + decisions.length;
    return {
      decisions,
      ...(decisions.length
        ? { nextCursor: Buffer.from(String(next)).toString("base64url") }
        : {}),
    };
  }

  async history(cursor: string | undefined, limit: number, scope?: Scope) {
    const offset = decodeCursor(cursor);
    const filtered = this.projectedEvents().filter(
      (event) => !scope || event.scope === scope,
    );
    const rows = filtered.slice(offset, offset + limit + 1);
    const decisions = rows.slice(0, limit);
    const next = offset + decisions.length;
    return {
      decisions,
      hasMore: rows.length > limit,
      ...(rows.length > limit
        ? { nextCursor: Buffer.from(String(next)).toString("base64url") }
        : {}),
    };
  }

  async queue(scope: Scope | undefined, now: Date): Promise<QueueItem[]> {
    const items: QueueItem[] = [];
    for (const state of this.candidates.values()) {
      if (scope && state.candidate.scope !== scope) continue;
      const pending = [...state.rounds.entries()]
        .filter(([, round]) => !round.verdictId)
        .sort(([left], [right]) => right - left)[0];
      if (!pending) continue;
      const [roundNumber, round] = pending;
      if (round.dueAt && new Date(round.dueAt) > now) continue;
      items.push({
        candidate: state.candidate,
        round: roundNumber,
        kind: round.kind,
        ...(round.dueAt ? { dueAt: round.dueAt } : {}),
        status: !round.dueAt
          ? "pending"
          : new Date(round.dueAt) < now
            ? "overdue"
            : "due",
      });
    }
    return items;
  }

  async decide(
    candidateId: string,
    roundNumber: number,
    input: VerdictInput,
    now: Date,
    reviewer: string,
  ) {
    const state = this.requireCandidate(candidateId);
    const round = state.rounds.get(roundNumber);
    if (!round) throw new Error("Candidate not found.");
    if (round.verdictId)
      throw new ConflictError("Review round is already decided.");
    if (round.dueAt && new Date(round.dueAt) > now)
      throw new ConflictError("Review is not due yet.");
    return this.appendDecision(
      state,
      roundNumber,
      round,
      input,
      now,
      reviewer,
    );
  }

  async amendDecision(
    candidateId: string,
    roundNumber: number,
    input: AmendVerdictInput,
    now: Date,
    reviewer: string,
  ) {
    const state = this.requireCandidate(candidateId);
    const round = state.rounds.get(roundNumber);
    if (!round?.verdictId)
      throw new ConflictError("Review round has no decision to amend.");
    if (round.verdictId !== input.expectedDecisionId)
      throw new ConflictError(
        "Decision changed since it was loaded. Refresh and try again.",
      );
    if (
      [...state.rounds.entries()].some(
        ([number, later]) => number > roundNumber && later.verdictId,
      )
    )
      throw new ConflictError(
        "This decision cannot be amended after a later round was decided.",
      );
    const current = this.events.find(
      (event) => event.decisionId === round.verdictId,
    );
    if (!current) throw new Error("Authoritative decision not found.");
    if (current.action === input.action && input.action !== "defer")
      throw new ValidationError("Choose a different verdict.");
    validateVerdict(
      round.kind,
      input,
      now,
      this.authoritativeConfirmations(state),
    );

    const successor = state.rounds.get(roundNumber + 1);
    if (successor) {
      if (successor.verdictId)
        throw new ConflictError(
          "This decision cannot be amended after a later round was decided.",
        );
      state.rounds.delete(roundNumber + 1);
    }
    return this.appendDecision(
      state,
      roundNumber,
      round,
      input,
      now,
      reviewer,
      current.decisionId,
    );
  }

  async summary(now: Date) {
    const queue = await this.queue(undefined, now);
    return {
      pending: queue.filter((item) => item.status === "pending").length,
      due: queue.filter((item) => item.status === "due").length,
      overdue: queue.filter((item) => item.status === "overdue").length,
    };
  }

  async migrate() {}
  async close() {}

  private requireCandidate(candidateId: string) {
    const state = this.candidates.get(candidateId);
    if (!state) throw new Error("Candidate not found.");
    return state;
  }

  private appendDecision(
    state: CandidateState,
    roundNumber: number,
    round: Round,
    input: VerdictInput,
    now: Date,
    reviewer: string,
    amendsDecisionId?: string,
  ) {
    const confirmations = this.authoritativeConfirmations(state);
    const schedule = validateVerdict(
      round.kind,
      input,
      now,
      confirmations,
    );
    const decisionId = crypto.randomUUID();
    const candidate = state.candidate;
    const decision: Decision = {
      decisionId,
      candidateId: candidate.candidateId,
      round: roundNumber,
      action: input.action,
      roundKind: round.kind,
      effect: schedule.effect,
      ...(amendsDecisionId ? { amendsDecisionId } : {}),
      isCurrent: true,
      canAmend: true,
      scope: candidate.scope,
      ...(candidate.scope === "project"
        ? {
            projectKey: candidate.projectKey,
            projectDisplayName: candidate.projectDisplayName,
          }
        : {}),
      lessonKey: candidate.lessonKey,
      title: candidate.title,
      body: candidate.body,
      evidence: candidate.evidence,
      reviewedAt: now.toISOString(),
      reviewer,
      ...(schedule.nextReviewAt
        ? { nextReviewAt: schedule.nextReviewAt.toISOString() }
        : {}),
    };
    this.events.push(decision);
    round.verdictId = decisionId;
    if (schedule.nextReviewAt && schedule.nextRoundKind) {
      state.rounds.set(roundNumber + 1, {
        kind: schedule.nextRoundKind,
        dueAt: schedule.nextReviewAt.toISOString(),
      });
    }
    return decision;
  }

  private authoritativeConfirmations(state: CandidateState) {
    return [...state.rounds.values()].filter((round) => {
      if (!round.verdictId) return false;
      return this.events.find(
        (event) => event.decisionId === round.verdictId,
      )?.action === "confirm_valid";
    }).length;
  }

  private projectedEvents() {
    return this.events.map((event) => {
      const state = this.candidates.get(event.candidateId);
      const round = state?.rounds.get(event.round);
      const isCurrent = round?.verdictId === event.decisionId;
      const laterDecided = state
        ? [...state.rounds.entries()].some(
            ([number, later]) => number > event.round && later.verdictId,
          )
        : false;
      return { ...event, isCurrent, canAmend: isCurrent && !laterDecided };
    });
  }
}

function decodeCursor(cursor: string | undefined) {
  const offset = cursor
    ? Number(Buffer.from(cursor, "base64url").toString())
    : 0;
  if (!Number.isInteger(offset) || offset < 0)
    throw new Error("Invalid cursor.");
  return offset;
}
