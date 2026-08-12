import { describe, expect, it } from "vitest";
import type { DecisionRecordItem, QueueItem } from "@tools-platform/field-guide";
import { decisionEmptyState, filterQueueItems, queueProjectOptions, reconcileCompletedCandidate, reconcileReviewedDecision } from "../field-guide/ui/review-state.js";

describe("candidate workbench filters", () => {
  const items = [queueItem("Project B", "pending", "initial"), queueItem("Project A", "overdue", "scheduled")];

  it("builds stable project choices from the loaded queue", () => {
    expect(queueProjectOptions(items)).toEqual(["Project A", "Project B"]);
  });

  it("combines project, kind, due state, and text criteria", () => {
    expect(filterQueueItems(items, {
      queueProject: "Project A",
      queueKind: "scheduled",
      queueStatus: "overdue",
      queueQuery: "guidance project"
    })).toEqual([items[1]]);
  });

  it("derives the visible project count from filtered candidates", () => {
    const filtered = filterQueueItems(items, { queueStatus: "overdue" });

    expect(queueProjectOptions(filtered)).toEqual(["Project A"]);
  });

  it("removes completed candidates and updates their summary bucket once", () => {
    const queue = { items, summary: { pending: 1, due: 0, overdue: 1 } };

    const updated = reconcileCompletedCandidate(queue, items[0]!);
    const unchanged = reconcileCompletedCandidate(updated, items[0]!);

    expect(updated).toEqual({ items: [items[1]], summary: { pending: 0, due: 0, overdue: 1 } });
    expect(unchanged).toBe(updated);
  });
});

describe("unreviewed decision reconciliation", () => {
  it("removes the reviewed row and decrements the unresolved count once", () => {
    const first = decisionItem("first");
    const second = decisionItem("second");
    const page = { items: [first, second], pending: 2, hasMore: true, nextCursor: "next" };

    const updated = reconcileReviewedDecision(page, "first");
    const unchanged = reconcileReviewedDecision(updated, "missing");

    expect(updated).toEqual({ items: [second], pending: 1, hasMore: true, nextCursor: "next" });
    expect(unchanged.pending).toBe(1);
  });

  it("keeps the next page reachable after reviewing the final loaded row", () => {
    const page = { items: [decisionItem("last-loaded")], pending: 2, hasMore: true, nextCursor: "next" };

    const updated = reconcileReviewedDecision(page, "last-loaded");
    const emptyState = decisionEmptyState(updated, "unreviewed");

    expect(updated).toEqual({ items: [], pending: 1, hasMore: true, nextCursor: "next" });
    expect(emptyState).toEqual({
      canLoadMore: true,
      title: "No decisions on this page",
      body: "More matching decisions are available on the next page."
    });
  });
});

function decisionItem(decisionRecordId: string): DecisionRecordItem {
  return {
    record: {
      schemaVersion: 1,
      decisionRecordId,
      taskId: "task",
      scope: "project",
      device: "device",
      harness: "codex",
      projectKey: "project",
      projectDisplayName: "Project",
      summary: "Summary",
      context: "Context",
      choice: "Choice",
      options: [],
      rationale: "Rationale",
      consequences: [],
      evidence: [],
      confidence: "high",
      createdAt: "2026-08-04T00:00:00.000Z"
    },
    currentFeedback: undefined,
    feedbackHistory: [],
    promotionCandidateId: undefined,
    archived: false
  };
}

function queueItem(projectDisplayName: string, status: QueueItem["status"], kind: QueueItem["kind"]): QueueItem {
  return {
    candidate: {
      candidateId: crypto.randomUUID(),
      scope: "project",
      projectKey: projectDisplayName.toLocaleLowerCase().replace(" ", "-"),
      projectDisplayName,
      lessonKey: "guidance",
      title: `${projectDisplayName} guidance`,
      body: "Body",
      rationale: "Rationale",
      evidence: [],
      createdAt: "2026-08-04T00:00:00.000Z"
    },
    round: 1,
    kind,
    status
  };
}
