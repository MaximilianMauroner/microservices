import { createServerFn } from "@tanstack/react-start";
import type {
  PrivateSnapshotDocument
} from "@tools-platform/domain";
import type { MarkdownAdminSnapshot } from "@tools-platform/web";
import type {
  DecisionRecordPage,
  DecisionRecordItem,
  DecisionReviewState,
  Decision,
  HistoryPage,
  QueueItem,
  Scope,
  Summary
} from "@tools-platform/field-guide";
import { requirePlatformSession } from "./auth-middleware.js";
import { internalPlatformRequest, readPlatformJson } from "./server-data.js";
import type { MoneyTrackerSnapshot } from "../money/money-tracker.js";

export type ReviewView = "decisions" | "queue" | "history";

export type ReviewLoaderInput = {
  scope: Scope;
  view: ReviewView;
  reviewState: DecisionReviewState;
  filters?: Partial<{
    projectKey: string;
    taskId: string;
    device: string;
    harness: string;
    skill: string;
    from: string;
    to: string;
  }>;
};

export type ReviewPageData = {
  actor: string;
  scope: Scope;
  view: ReviewView;
  reviewState: DecisionReviewState;
  decisions?: DecisionRecordPage;
  queue?: { items: QueueItem[]; summary: Summary };
  history?: HistoryPage & { summary: Summary };
};

export const getReviewPageData = createServerFn({ method: "GET" })
  .middleware([requirePlatformSession])
  .validator((input: ReviewLoaderInput) => input)
  .handler(async ({ data }): Promise<ReviewPageData> => {
    const { context } = internalPlatformRequest("/api/review/queue");
    const actor = context.principal?.email ?? "Authenticated user";
    if (data.view === "queue") {
      const query = new URLSearchParams({ scope: data.scope });
      const result = await readPlatformJson<{ items: QueueItem[]; summary: Summary }>(context.runtime.services.review.handle, `/api/review/queue?${query}`);
      return { actor, scope: data.scope, view: data.view, reviewState: data.reviewState, queue: result };
    }
    if (data.view === "history") {
      const query = new URLSearchParams({ scope: data.scope, limit: "25" });
      const result = await readPlatformJson<HistoryPage & { summary: Summary }>(context.runtime.services.review.handle, `/api/review/history?${query}`);
      return { actor, scope: data.scope, view: data.view, reviewState: data.reviewState, history: result };
    }
    const query = new URLSearchParams({
      scope: data.scope,
      reviewState: data.reviewState,
      limit: "25"
    });
    for (const [key, value] of Object.entries(data.filters ?? {})) {
      if (value) query.set(key, value);
    }
    const result = await readPlatformJson<DecisionRecordPage>(context.runtime.services.review.handle, `/api/review/decision-records?${query}`);
    return { actor, scope: data.scope, view: data.view, reviewState: data.reviewState, decisions: result };
  });

export type UploadSummary = {
  id: string;
  kind: "html" | "file";
  filename: string;
  contentType: string;
  url: string;
  bytes: number;
  updatedAt: string;
  expiresAt?: string;
  project?: string;
};

export type UploadPageData = {
  uploads: UploadSummary[];
  nextCursor?: string;
};

export type ManagePageData = UploadPageData;

export type PrivateStatusPageData = {
  actor: string;
  publicOrigin: string;
  snapshot: PrivateSnapshotDocument;
};

export type DocumentsPageData = MarkdownAdminSnapshot & {
  actor: string;
  publicOrigin: string;
};

export type MoneyTrackerPageData = MoneyTrackerSnapshot & { actor: string };

export const getMoneyTrackerPageData = createServerFn({ method: "GET" })
  .middleware([requirePlatformSession])
  .handler(async (): Promise<MoneyTrackerPageData> => {
    const { context } = internalPlatformRequest("/money");
    return {
      actor: context.principal?.email ?? "Authenticated user",
      ...await context.runtime.moneyTracker.readSnapshot()
    };
  });

export const getPrivateStatusPageData = createServerFn({ method: "GET" })
  .middleware([requirePlatformSession])
  .handler(async (): Promise<PrivateStatusPageData> => {
    const { context } = internalPlatformRequest("/api/ops/snapshot");
    return {
      actor: context.principal?.email ?? "Authenticated user",
      publicOrigin: context.runtime.publicOrigin,
      snapshot: await readPlatformJson<PrivateSnapshotDocument>(context.runtime.services.manage.handle, "/api/ops/snapshot")
    };
  });

export const getManagePageData = createServerFn({ method: "GET" })
  .middleware([requirePlatformSession])
  .handler(async (): Promise<ManagePageData> => {
    const { context, request } = internalPlatformRequest(
      "/api/external-uploads?limit=100&sort=newest"
    );
    const response = await context.runtime.services.publisher.handle(request);
    if (!response.ok) throw new Error(`Artifact inventory request failed: ${response.status}`);
    return response.json() as Promise<ManagePageData>;
  });

export const getDocumentsPageData = createServerFn({ method: "GET" })
  .middleware([requirePlatformSession])
  .handler(async (): Promise<DocumentsPageData> => {
    const { context } = internalPlatformRequest("/api/ops/documents");
    const result = await readPlatformJson<MarkdownAdminSnapshot & { publicOrigin: string }>(
      context.runtime.services.manage.handle,
      "/api/ops/documents"
    );
    return {
      ...result,
      actor: context.principal?.email ?? "Authenticated user"
    };
  });

export type ReviewDetailData = DecisionRecordItem;
export type ReviewHistoryDecision = Decision;
