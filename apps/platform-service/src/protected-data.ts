import { createServerFn } from "@tanstack/react-start";
import type {
  CatalogDocument,
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
import { createPlatformAccessFunctionMiddleware } from "./access-middleware.js";
import { internalPlatformRequest, readPlatformJson } from "./server-data.js";
import type { MoneyTrackerSnapshot } from "./features/money/money-tracker.js";

const reviewAccessMiddleware = createPlatformAccessFunctionMiddleware("review");
const publisherAccessMiddleware = createPlatformAccessFunctionMiddleware("publisher");
const manageAccessMiddleware = createPlatformAccessFunctionMiddleware("manage");

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
  .middleware([reviewAccessMiddleware])
  .validator((input: ReviewLoaderInput) => input)
  .handler(async ({ data }): Promise<ReviewPageData> => {
    const { context } = internalPlatformRequest("/api/review/queue");
    const actor = context.accessActor?.id ?? "Access protected";
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

export const getPublishPageData = createServerFn({ method: "GET" })
  .middleware([publisherAccessMiddleware])
  .handler(async (): Promise<UploadPageData> => {
    const { context, request } = internalPlatformRequest("/api/external-uploads?limit=25");
    const response = await context.runtime.services.publisher.handle(request);
    if (!response.ok) throw new Error(`Upload inventory request failed: ${response.status}`);
    return response.json() as Promise<UploadPageData>;
  });

export type ManagePageData = {
  actor: string;
  revision: string;
  catalog: CatalogDocument;
  snapshot: PrivateSnapshotDocument;
};

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
  .middleware([manageAccessMiddleware])
  .handler(async (): Promise<MoneyTrackerPageData> => {
    const { context } = internalPlatformRequest("/tools/private/money");
    return {
      actor: context.accessActor?.id ?? "Access protected",
      ...await context.runtime.moneyTracker.readSnapshot()
    };
  });

export const getPrivateStatusPageData = createServerFn({ method: "GET" })
  .middleware([manageAccessMiddleware])
  .handler(async (): Promise<PrivateStatusPageData> => {
    const { context } = internalPlatformRequest("/api/ops/snapshot");
    return {
      actor: context.accessActor?.id ?? "Access protected",
      publicOrigin: context.runtime.publicOrigin,
      snapshot: await readPlatformJson<PrivateSnapshotDocument>(context.runtime.services.manage.handle, "/api/ops/snapshot")
    };
  });

export const getManagePageData = createServerFn({ method: "GET" })
  .middleware([manageAccessMiddleware])
  .handler(async (): Promise<ManagePageData> => {
    const { context } = internalPlatformRequest("/api/ops/catalog");
    const [catalog, snapshot] = await Promise.all([
      readPlatformJson<CatalogDocument>(context.runtime.services.manage.handle, "/api/ops/catalog"),
      readPlatformJson<PrivateSnapshotDocument>(context.runtime.services.manage.handle, "/api/ops/snapshot")
    ]);
    return {
      actor: context.accessActor?.id ?? "Access protected",
      revision: catalog.revision,
      catalog,
      snapshot: { ...snapshot, catalog, catalogRevision: catalog.revision }
    };
  });

export const getDocumentsPageData = createServerFn({ method: "GET" })
  .middleware([manageAccessMiddleware])
  .handler(async (): Promise<DocumentsPageData> => {
    const { context } = internalPlatformRequest("/api/ops/documents");
    const result = await readPlatformJson<MarkdownAdminSnapshot & { publicOrigin: string }>(
      context.runtime.services.manage.handle,
      "/api/ops/documents"
    );
    return {
      ...result,
      actor: context.accessActor?.id ?? "Access protected"
    };
  });

export type ReviewDetailData = DecisionRecordItem;
export type ReviewHistoryDecision = Decision;
