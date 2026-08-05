import { describe, expect, it } from "vitest";
import { planScopeReassignment, planVerdict } from "../src/candidate-lifecycle.js";

const now = new Date("2026-08-05T12:00:00.000Z");

describe("candidate lifecycle engine", () => {
  it("plans the same scheduled review independently of storage", () => {
    const plan = planVerdict({ kind: "initial", input: { action: "approve" }, now, confirmations: 0 });
    expect(plan.effect).toBe("activate");
    expect(plan.nextRoundKind).toBe("scheduled");
    expect(plan.nextReviewAt?.toISOString()).toBe("2026-08-12T12:00:00.000Z");
  });

  it("preserves project origin when promoting a candidate", () => {
    const candidate = planScopeReassignment({
      candidate: { candidateId: "candidate", scope: "project", projectKey: "owner/repo", projectDisplayName: "repo", lessonKey: "lesson", title: "Title", body: "Body", rationale: "Why", evidence: [], createdAt: now.toISOString() },
      round: 1,
      kind: "initial",
      hasEvents: false,
      scope: "global",
      now,
      reviewer: "reviewer@example.com"
    });
    expect(candidate).toMatchObject({ scope: "global", foundProjectKey: "owner/repo", foundProjectDisplayName: "repo" });
    expect(candidate.projectKey).toBeUndefined();
  });
});
