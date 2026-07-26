import { expect, it } from "vitest";
import { MemoryReviewRepository } from "../src/memory-repository.js";

const now = new Date("2026-07-26T00:00:00Z");
const make = (id: string, key: string) => ({
  candidateId: id,
  scope: "project" as const,
  projectKey: key,
  projectDisplayName: `Project ${key}`,
  lessonKey: key,
  title: key,
  body: key,
  rationale: key,
  evidence: [{ excerpt: key, commitHashes: [key] }],
  createdAt: now.toISOString(),
});

it("keeps the agent feed ascending while reviewer history pages newest first", async () => {
  const repository = new MemoryReviewRepository();
  const firstCandidate = make(
    "11111111-1111-4111-8111-111111111111",
    "first",
  );
  const newestCandidate = make(
    "22222222-2222-4222-8222-222222222222",
    "newest",
  );
  await repository.createCandidate("first", firstCandidate);
  await repository.createCandidate("newest", newestCandidate);
  const firstDecision = await repository.decide(
    firstCandidate.candidateId,
    1,
    { action: "approve" },
    now,
    "owner@example.com",
  );
  const newestDecision = await repository.decide(
    newestCandidate.candidateId,
    1,
    { action: "approve" },
    now,
    "owner@example.com",
  );

  const agentFeed = await repository.decisions(undefined, 100);
  expect(agentFeed.decisions.map((decision) => decision.decisionId)).toEqual([
    firstDecision.decisionId,
    newestDecision.decisionId,
  ]);
  expect(agentFeed.nextCursor).toBeTruthy();

  const firstPage = await repository.history(undefined, 1, "project");
  expect(firstPage).toMatchObject({ hasMore: true });
  expect(firstPage.decisions[0]).toMatchObject({
    decisionId: newestDecision.decisionId,
    projectKey: "newest",
    projectDisplayName: "Project newest",
  });
  const olderPage = await repository.history(
    firstPage.nextCursor,
    1,
    "project",
  );
  expect(olderPage.hasMore).toBe(false);
  expect(olderPage.nextCursor).toBeUndefined();
  expect(olderPage.decisions[0]?.decisionId).toBe(firstDecision.decisionId);
});

it("omits project identity from global decisions", async () => {
  const repository = new MemoryReviewRepository();
  const candidate = {
    ...make("33333333-3333-4333-8333-333333333333", "global"),
    scope: "global" as const,
    projectKey: undefined,
    projectDisplayName: undefined,
  };
  await repository.createCandidate("global", candidate);
  const decision = await repository.decide(
    candidate.candidateId,
    1,
    { action: "approve" },
    now,
    "owner@example.com",
  );
  expect(decision).not.toHaveProperty("projectKey");
  expect(decision).not.toHaveProperty("projectDisplayName");
});
