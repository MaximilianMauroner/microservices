export type Scope = "project" | "global";
export type Evidence = {
  excerpt: string;
  sessionRef?: string;
  commitHashes: string[];
};
export type Candidate = {
  candidateId: string;
  scope: Scope;
  projectKey?: string;
  projectDisplayName?: string;
  foundProjectKey?: string;
  foundProjectDisplayName?: string;
  scopeChangedAt?: string;
  scopeChangedBy?: string;
  lessonKey: string;
  title: string;
  body: string;
  rationale: string;
  evidence: Evidence[];
  createdAt: string;
};
export type Action =
  "approve" | "reject" | "defer" | "confirm_valid" | "mark_invalid";
export type RoundKind = "initial" | "scheduled";
export type Effect = "activate" | "deactivate";
export type Decision = {
  decisionId: string;
  candidateId: string;
  round: number;
  action: Action;
  roundKind: RoundKind;
  effect: Effect;
  amendsDecisionId?: string;
  isCurrent: boolean;
  canAmend: boolean;
  scope: Scope;
  projectKey?: string;
  projectDisplayName?: string;
  foundProjectKey?: string;
  foundProjectDisplayName?: string;
  lessonKey: string;
  title: string;
  body: string;
  evidence: Evidence[];
  reviewedAt: string;
  reviewer: string;
  nextReviewAt?: string;
};
export type Summary = { pending: number; due: number; overdue: number };
export type QueueItem = {
  candidate: Candidate;
  round: number;
  kind: RoundKind;
  dueAt?: string;
  status: "pending" | "due" | "overdue";
};
export type VerdictInput = { action: Action; deferUntil?: string };
export type AmendVerdictInput = VerdictInput & { expectedDecisionId: string };
export type Page = { decisions: Decision[]; nextCursor?: string };
export type HistoryPage = { decisions: Decision[]; nextCursor?: string; hasMore: boolean };

export type DecisionConfidence = "low" | "medium" | "high";
export type DecisionRecordOption = {
  label: string;
  rejectedBecause?: string;
};
export type DecisionRecordEvidence = {
  excerpt: string;
  commitHashes: string[];
};
export type DecisionRecord = {
  schemaVersion: 1;
  decisionRecordId: string;
  taskId: string;
  scope: Scope;
  projectKey?: string;
  projectDisplayName?: string;
  summary: string;
  context: string;
  options: DecisionRecordOption[];
  choice: string;
  rationale: string;
  consequences: string[];
  confidence: DecisionConfidence;
  evidence: DecisionRecordEvidence[];
  device?: string;
  harness?: string;
  skill?: string;
  createdAt: string;
};
export type DecisionFeedbackAction = "up" | "down" | "dismiss";
export type DecisionFeedback = {
  feedbackId: string;
  decisionRecordId: string;
  action: DecisionFeedbackAction;
  comment?: string;
  reviewer: string;
  reviewedAt: string;
  amendsFeedbackId?: string;
};
export type DecisionRecordItem = {
  record: DecisionRecord;
  currentFeedback?: DecisionFeedback;
  feedbackHistory: DecisionFeedback[];
  promotionCandidateId?: string;
  archived: boolean;
};
export type DecisionReviewState = "unreviewed" | "reviewed" | "all";
export type DecisionRecordFilters = {
  cursor?: string;
  limit: number;
  projectKey?: string;
  taskId?: string;
  reviewState: DecisionReviewState;
  device?: string;
  harness?: string;
  skill?: string;
  from?: string;
  to?: string;
  includeArchived: boolean;
  archiveAfterDays: number;
  now: Date;
};
export type DecisionRecordPage = {
  items: DecisionRecordItem[];
  pending: number;
  hasMore: boolean;
  nextCursor?: string;
};
export type DecisionFeedbackInput = {
  action: DecisionFeedbackAction;
  comment?: string;
  expectedFeedbackId?: string;
};
export type DecisionPromotion = {
  candidateId: string;
  decisionRecordIds: string[];
  promotedAt: string;
  promotedBy: string;
};
export interface ReviewRepository {
  createCandidate(
    key: string,
    candidate: Candidate,
  ): Promise<"created" | "replay">;
  createReceipt(
    key: string,
    decisionId: string,
    appliedAt: string,
    result: "applied" | "already_applied",
  ): Promise<"created" | "replay">;
  decisions(
    cursor: string | undefined,
    limit: number,
    scope?: Scope,
  ): Promise<Page>;
  history(cursor:string|undefined,limit:number,scope?:Scope):Promise<HistoryPage>;
  queue(scope: Scope | undefined, now: Date): Promise<QueueItem[]>;
  decide(
    candidateId: string,
    round: number,
    input: VerdictInput,
    now: Date,
    reviewer: string,
  ): Promise<Decision>;
  amendDecision(
    candidateId: string,
    round: number,
    input: AmendVerdictInput,
    now: Date,
    reviewer: string,
  ): Promise<Decision>;
  reassignScope(
    candidateId: string,
    round: number,
    scope: Scope,
    now: Date,
    reviewer: string,
  ): Promise<Candidate>;
  summary(now: Date): Promise<Summary>;
  createDecisionRecord(
    key: string,
    record: DecisionRecord,
  ): Promise<"created" | "replay">;
  decisionRecords(filters: DecisionRecordFilters): Promise<DecisionRecordPage>;
  decisionRecord(id: string, now: Date): Promise<DecisionRecordItem>;
  addDecisionFeedback(
    decisionRecordId: string,
    input: DecisionFeedbackInput,
    now: Date,
    reviewer: string,
  ): Promise<DecisionFeedback>;
  promoteDecisionRecords(
    key: string,
    decisionRecordIds: string[],
    candidate: Candidate,
    now: Date,
    reviewer: string,
  ): Promise<{ status: "created" | "replay"; promotion: DecisionPromotion }>;
  close(): Promise<void>;
}
export class ConflictError extends Error {}
export class ValidationError extends Error {}
export class NotFoundError extends Error {}
export const addDays = (d: Date, n: number) =>
  new Date(d.getTime() + n * 86_400_000);

const ACTIONS_BY_KIND = {
  initial: ["approve", "reject", "defer"],
  scheduled: ["confirm_valid", "mark_invalid", "defer"],
} as const satisfies Record<RoundKind, readonly Action[]>;

export function allowedActions(kind: RoundKind): readonly Action[] {
  return ACTIONS_BY_KIND[kind];
}

export function validateVerdict(
  kind: RoundKind,
  input: VerdictInput,
  now: Date,
  authoritativeConfirmations: number,
): { effect: Effect; nextReviewAt?: Date; nextRoundKind?: RoundKind } {
  if (!allowedActions(kind).includes(input.action))
    throw new ValidationError("Action is not valid for this review round.");
  if (input.action !== "defer" && input.deferUntil !== undefined)
    throw new ValidationError("deferUntil is only valid for a defer verdict.");

  let nextReviewAt: Date | undefined;
  let nextRoundKind: RoundKind | undefined;
  if (input.action === "defer") {
    nextReviewAt = new Date(input.deferUntil ?? "");
    if (
      !Number.isFinite(nextReviewAt.getTime()) ||
      nextReviewAt <= now ||
      nextReviewAt > addDays(now, 90)
    )
      throw new ValidationError(
        "deferUntil must be within the next 90 days.",
      );
    nextRoundKind = kind;
  } else if (input.action === "approve") {
    nextReviewAt = addDays(now, 7);
    nextRoundKind = "scheduled";
  } else if (input.action === "confirm_valid") {
    nextReviewAt = addDays(now, authoritativeConfirmations === 0 ? 30 : 90);
    nextRoundKind = "scheduled";
  }

  const effect: Effect =
    input.action === "approve" ||
    input.action === "confirm_valid" ||
    (kind === "scheduled" && input.action === "defer")
      ? "activate"
      : "deactivate";
  return {
    effect,
    ...(nextReviewAt ? { nextReviewAt, nextRoundKind } : {}),
  };
}

export function decodeCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined;
  if (!cursor || !/^[A-Za-z0-9_-]+$/.test(cursor))
    throw new ValidationError("Invalid cursor.");
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (
    !/^(0|[1-9]\d*)$/.test(decoded) ||
    Buffer.from(decoded).toString("base64url") !== cursor ||
    BigInt(decoded) > 9_223_372_036_854_775_807n
  )
    throw new ValidationError("Invalid cursor.");
  return decoded;
}

export const encodeCursor = (value: string | number) =>
  Buffer.from(String(value)).toString("base64url");
