import type { DecisionReviewState, QueueItem } from "@tools-platform/field-guide";
import type { ReviewPageData } from "../../src/protected-data.js";

export type ReviewFilters = {
  queueProject?: string;
  queueKind?: "all" | "initial" | "scheduled";
  queueStatus?: "all" | "pending" | "due" | "overdue";
  queueQuery?: string;
};

export function reconcileReviewedDecision(
  decisions: NonNullable<ReviewPageData["decisions"]>,
  reviewedId: string
) {
  const removed = decisions.items.some((item) => item.record.decisionRecordId === reviewedId);
  return {
    ...decisions,
    pending: removed ? Math.max(0, decisions.pending - 1) : decisions.pending,
    items: decisions.items.filter((item) => item.record.decisionRecordId !== reviewedId)
  };
}

export function decisionEmptyState(
  decisions: NonNullable<ReviewPageData["decisions"]>,
  reviewState: DecisionReviewState
) {
  const canLoadMore = Boolean(decisions.nextCursor);
  return {
    canLoadMore,
    title: canLoadMore ? "No decisions on this page" : `No ${reviewState} decisions`,
    body: canLoadMore
      ? "More matching decisions are available on the next page."
      : reviewState === "unreviewed"
        ? "Every uploaded decision has been reviewed."
        : "Decision records will appear here."
  };
}

export function filterQueueItems(items: QueueItem[], search: ReviewFilters) {
  const queryTokens = search.queueQuery?.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean) ?? [];
  return items.filter((item) => {
    if (search.queueProject && queueProject(item) !== search.queueProject) return false;
    if (search.queueKind && search.queueKind !== "all" && item.kind !== search.queueKind) return false;
    if (search.queueStatus && search.queueStatus !== "all" && item.status !== search.queueStatus) return false;
    if (!queryTokens.length) return true;
    const searchable = [item.candidate.title, item.candidate.body, item.candidate.rationale, queueProject(item)].join(" ").toLocaleLowerCase();
    return queryTokens.every((token) => searchable.includes(token));
  });
}

export function queueProjectOptions(items: QueueItem[]) {
  return [...new Set(items.map(queueProject))].sort((left, right) => left.localeCompare(right));
}

export function reconcileCompletedCandidate(
  queue: NonNullable<ReviewPageData["queue"]>,
  completed: QueueItem
) {
  const removed = queue.items.includes(completed);
  if (!removed) return queue;
  return {
    ...queue,
    items: queue.items.filter((item) => item !== completed),
    summary: {
      ...queue.summary,
      [completed.status]: Math.max(0, queue.summary[completed.status] - 1)
    }
  };
}

function queueProject(item: QueueItem) {
  return item.candidate.projectDisplayName ?? item.candidate.projectKey ?? "Global";
}
