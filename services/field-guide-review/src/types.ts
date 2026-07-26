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
export type Decision = {
  decisionId: string;
  candidateId: string;
  round: number;
  action: Action;
  scope: Scope;
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
  kind: "initial" | "scheduled";
  dueAt?: string;
  status: "pending" | "due" | "overdue";
};
export type VerdictInput = { action: Action; deferUntil?: string };
export type Page = { decisions: Decision[]; nextCursor?: string };
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
  queue(scope: Scope | undefined, now: Date): Promise<QueueItem[]>;
  decide(
    candidateId: string,
    round: number,
    input: VerdictInput,
    now: Date,
    reviewer: string,
  ): Promise<Decision>;
  summary(now: Date): Promise<Summary>;
  migrate(): Promise<void>;
  close(): Promise<void>;
}
export class ConflictError extends Error {}
export const addDays = (d: Date, n: number) =>
  new Date(d.getTime() + n * 86_400_000);
