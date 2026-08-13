import crypto from "node:crypto";
import { planAmendment, planScopeReassignment, planVerdict } from "./candidate-lifecycle.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  canonicalUuid,
  decodeCursor,
  encodeCursor,
  type AmendVerdictInput,
  type Candidate,
  type Decision,
  type DecisionFeedback,
  type DecisionFeedbackInput,
  type DecisionPromotion,
  type DecisionRecord,
  type DecisionRecordFilters,
  type DecisionRecordItem,
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
  private decisionRecordKeys = new Map<string, string>();
  private decisionRecordValues: DecisionRecord[] = [];
  private decisionFeedback = new Map<string, DecisionFeedback[]>();
  private decisionPromotions = new Map<string, DecisionPromotion>();
  private promotionKeys = new Map<string, string>();

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
    const after = BigInt(decodeCursor(cursor) ?? "0");
    const rows = this.sequencedEvents().filter(
      ({ decision, sequence }) =>
        sequence > after && (!scope || decision.scope === scope),
    );
    const page = rows.slice(0, limit);
    return {
      decisions: page.map(({ decision }) => decision),
      ...(page.length
        ? { nextCursor: encodeCursor(page.at(-1)?.sequence.toString() ?? "0") }
        : {}),
    };
  }

  async history(cursor: string | undefined, limit: number, scope?: Scope) {
    const before = decodeCursor(cursor);
    const rows = this.sequencedEvents()
      .filter(
        ({ decision, sequence }) =>
          (!before || sequence < BigInt(before)) &&
          (!scope || decision.scope === scope),
      )
      .reverse()
      .slice(0, limit + 1);
    const page = rows.slice(0, limit);
    return {
      decisions: page.map(({ decision }) => decision),
      hasMore: rows.length > limit,
      ...(rows.length > limit
        ? { nextCursor: encodeCursor(page.at(-1)?.sequence.toString() ?? "0") }
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
    planVerdict({ kind: round.kind, input, now, confirmations: this.authoritativeConfirmations(state), verdictId: round.verdictId, dueAt: round.dueAt ? new Date(round.dueAt) : null });
    return this.appendDecision(
      state,
      roundNumber,
      round,
      input,
      now,
      reviewer,
    );
  }

  async reassignScope(
    candidateId: string,
    roundNumber: number,
    scope: Scope,
    now: Date,
    reviewer: string,
  ) {
    const state = this.requireCandidate(candidateId);
    const round = state.rounds.get(roundNumber);
    if (!round) throw new Error("Candidate not found.");
    const changed = planScopeReassignment({ candidate: state.candidate, round: roundNumber, kind: round.kind, verdictId: round.verdictId, hasEvents: this.events.some((event) => event.candidateId === candidateId), scope, now, reviewer });
    state.candidate = changed;
    return state.candidate;
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
    if (!round) throw new ConflictError("Review round has no decision to amend.");
    const current = this.events.find(
      (event) => event.decisionId === round.verdictId,
    );
    if (!current) throw new Error("Authoritative decision not found.");
    planAmendment({ kind: round.kind, input, now, confirmations: this.authoritativeConfirmations(state), currentDecisionId: round.verdictId, currentAction: current.action, currentNextReviewAt: current.nextReviewAt ? new Date(current.nextReviewAt) : null, hasDecidedDescendant: [...state.rounds.entries()].some(([number, later]) => number > roundNumber && Boolean(later.verdictId)) });

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

  async createDecisionRecord(key: string, record: DecisionRecord) {
    const normalizedRecord = {
      ...record,
      decisionRecordId: canonicalUuid(record.decisionRecordId, "decisionRecordId"),
    };
    const serialized = JSON.stringify(normalizedRecord);
    const existing = this.decisionRecordKeys.get(key);
    if (existing) {
      if (existing !== serialized)
        throw new ConflictError("Idempotency key already has different content.");
      return "replay" as const;
    }
    if (this.decisionRecordValues.some((value) => value.decisionRecordId === normalizedRecord.decisionRecordId))
      throw new ConflictError("Decision record already exists.");
    this.decisionRecordKeys.set(key, serialized);
    this.decisionRecordValues.push(normalizedRecord);
    return "created" as const;
  }

  async decisionRecords(filters: DecisionRecordFilters) {
    const before = decodeCursor(filters.cursor);
    const rows = this.decisionRecordValues
      .map((record, index) => ({ record, sequence: BigInt(index + 1) }))
      .filter(({ record, sequence }) =>
        (!before || sequence < BigInt(before)) &&
        record.scope === filters.scope &&
        (!filters.projectKey || (record.foundProjectKey ?? record.projectKey) === filters.projectKey) &&
        (!filters.taskId || record.taskId === filters.taskId) &&
        (!filters.device || record.device === filters.device) &&
        (!filters.harness || record.harness === filters.harness) &&
        (!filters.skill || record.skill === filters.skill) &&
        (!filters.from || record.createdAt >= filters.from) &&
        (!filters.to || record.createdAt <= filters.to),
      )
      .map(({ record, sequence }) => ({ item: this.decisionRecordItem(record, filters.now, filters.archiveAfterDays), sequence }))
      .filter(({ item }) =>
        filters.reviewState === "all" ||
        (filters.reviewState === "reviewed") === Boolean(item.currentFeedback),
      )
      .filter(({ item }) => filters.includeArchived || !item.archived)
      .sort((left, right) => Number(right.sequence - left.sequence));
    const page = rows.slice(0, filters.limit);
    return {
      items: page.map(({ item }) => item),
      pending: this.decisionRecordValues.filter((record) =>
        record.scope === filters.scope && !this.currentFeedback(record.decisionRecordId),
      ).length,
      hasMore: rows.length > filters.limit,
      ...(rows.length > filters.limit
        ? { nextCursor: encodeCursor(page.at(-1)?.sequence.toString() ?? "0") }
        : {}),
    };
  }

  async decisionRecord(id: string, now: Date, archiveAfterDays: number) {
    id = canonicalUuid(id, "decisionRecordId");
    const record = this.decisionRecordValues.find((value) => value.decisionRecordId === id);
    if (!record) throw new NotFoundError("Decision record not found.");
    return this.decisionRecordItem(record, now, archiveAfterDays);
  }

  async addDecisionFeedback(
    decisionRecordId: string,
    input: DecisionFeedbackInput,
    now: Date,
    reviewer: string,
  ) {
    decisionRecordId = canonicalUuid(decisionRecordId, "decisionRecordId");
    const expectedFeedbackId = input.expectedFeedbackId === undefined
      ? undefined
      : canonicalUuid(input.expectedFeedbackId, "expectedFeedbackId");
    if (!this.decisionRecordValues.some((record) => record.decisionRecordId === decisionRecordId))
      throw new NotFoundError("Decision record not found.");
    const current = this.currentFeedback(decisionRecordId);
    if (expectedFeedbackId !== undefined && expectedFeedbackId !== current?.feedbackId)
      throw new ConflictError("Feedback changed since it was loaded. Refresh and try again.");
    if (current && expectedFeedbackId === undefined)
      throw new ConflictError("Feedback already exists. Amend the current feedback instead.");
    const feedback: DecisionFeedback = {
      feedbackId: crypto.randomUUID(),
      decisionRecordId,
      action: input.action,
      ...(input.comment ? { comment: input.comment } : {}),
      reviewer,
      reviewedAt: now.toISOString(),
      ...(current ? { amendsFeedbackId: current.feedbackId } : {}),
    };
    this.decisionFeedback.set(decisionRecordId, [...(this.decisionFeedback.get(decisionRecordId) ?? []), feedback]);
    return feedback;
  }

  async promoteDecisionRecords(
    key: string,
    decisionRecordIds: string[],
    candidate: Candidate,
    now: Date,
    reviewer: string,
  ) {
    decisionRecordIds = decisionRecordIds.map((id) => canonicalUuid(id, "decisionRecordId"));
    if (new Set(decisionRecordIds).size !== decisionRecordIds.length)
      throw new ValidationError("decisionRecordIds contains duplicates.");
    candidate = { ...candidate, candidateId: canonicalUuid(candidate.candidateId, "candidateId") };
    const serialized = JSON.stringify({ decisionRecordIds, candidate });
    const existing = this.promotionKeys.get(key);
    if (existing) {
      if (existing !== serialized)
        throw new ConflictError("Idempotency key already has different content.");
      const promotion = this.decisionPromotions.get(candidate.candidateId);
      if (!promotion) throw new Error("Promotion state is inconsistent.");
      return { status: "replay" as const, promotion };
    }
    for (const id of decisionRecordIds) {
      if (!this.decisionRecordValues.some((record) => record.decisionRecordId === id))
        throw new NotFoundError("Decision record not found.");
      if (!this.currentFeedback(id))
        throw new ValidationError("Every promoted decision record must be reviewed.");
      if ([...this.decisionPromotions.values()].some((promotion) => promotion.decisionRecordIds.includes(id)))
        throw new ConflictError("Decision record has already been promoted.");
    }
    await this.createCandidate(`promotion:${key}`, candidate);
    const promotion: DecisionPromotion = {
      candidateId: candidate.candidateId,
      decisionRecordIds,
      promotedAt: now.toISOString(),
      promotedBy: reviewer,
    };
    this.promotionKeys.set(key, serialized);
    this.decisionPromotions.set(candidate.candidateId, promotion);
    return { status: "created" as const, promotion };
  }

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
    const schedule = planVerdict({ kind: round.kind, input, now, confirmations });
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
      ...candidateOrigin(candidate),
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

  private sequencedEvents() {
    return this.projectedEvents().map((decision, index) => ({
      decision,
      sequence: BigInt(index + 1),
    }));
  }

  private currentFeedback(decisionRecordId: string) {
    return this.decisionFeedback.get(decisionRecordId)?.at(-1);
  }

  private decisionRecordItem(record: DecisionRecord, now: Date, archiveAfterDays = 90): DecisionRecordItem {
    const feedbackHistory = this.decisionFeedback.get(record.decisionRecordId) ?? [];
    const currentFeedback = feedbackHistory.at(-1);
    const promotion = [...this.decisionPromotions.values()].find((value) =>
      value.decisionRecordIds.includes(record.decisionRecordId),
    );
    return {
      record,
      ...(currentFeedback ? { currentFeedback } : {}),
      feedbackHistory,
      ...(promotion ? { promotionCandidateId: promotion.candidateId } : {}),
      archived: Boolean(currentFeedback && now.getTime() - new Date(currentFeedback.reviewedAt).getTime() >= archiveAfterDays * 86_400_000),
    };
  }
}

function candidateOrigin(candidate: Candidate) {
  const foundProjectKey = candidate.foundProjectKey ?? candidate.projectKey;
  const foundProjectDisplayName =
    candidate.foundProjectDisplayName ?? candidate.projectDisplayName;
  return foundProjectKey && foundProjectDisplayName
    ? { foundProjectKey, foundProjectDisplayName }
    : {};
}
