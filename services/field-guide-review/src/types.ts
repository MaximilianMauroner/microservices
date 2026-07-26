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
  summary(now: Date): Promise<Summary>;
  migrate(): Promise<void>;
  close(): Promise<void>;
}
export class ConflictError extends Error {}
export class ValidationError extends Error {}
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
