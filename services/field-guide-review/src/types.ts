export type Scope = "project" | "global";
export type Evidence = { excerpt: string; sessionRef?: string; commitHashes: string[] };
export type Candidate = { candidateId: string; scope: Scope; projectKey?: string; projectDisplayName?: string; lessonKey: string; title: string; body: string; rationale: string; evidence: Evidence[]; createdAt: string };
export type Action = "approve" | "reject" | "defer" | "confirm_valid" | "mark_invalid";
export type Decision = { decisionId: string; candidateId: string; round: number; action: Action; scope: Scope; lessonKey: string; title: string; body: string; reviewedAt: string; nextReviewAt?: string };
export type Summary = { pending: number; due: number; overdue: number };
export type QueueItem = { candidate: Candidate; round: number; kind: "initial" | "scheduled"; dueAt?: string; status: "pending" | "due" | "overdue" };
export type VerdictInput = { action: Action; deferUntil?: string };
export interface ReviewRepository {
  createCandidate(key: string, candidate: Candidate): Promise<"created" | "replay">;
  createReceipt(key: string, decisionId: string, appliedAt: string, result: "applied" | "already_applied"): Promise<"created" | "replay">;
  decisions(cursor: string | undefined, limit: number): Promise<{ decisions: Decision[]; nextCursor?: string }>;
  queue(scope: Scope | undefined, now: Date): Promise<QueueItem[]>;
  decide(candidateId: string, round: number, input: VerdictInput, now: Date): Promise<Decision>;
  summary(now: Date): Promise<Summary>;
  migrate(): Promise<void>;
  close(): Promise<void>;
}
export class ConflictError extends Error {}
export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);
