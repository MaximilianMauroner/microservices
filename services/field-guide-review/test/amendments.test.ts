import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { MemoryReviewRepository } from "../src/memory-repository.js";

const pass: RequestHandler = (_request, _response, next) => next();
const origin = "https://reviews.example";
const start = new Date("2026-07-26T00:00:00.000Z");
const candidate = {
  candidateId: "11111111-1111-4111-8111-111111111111",
  scope: "project" as const,
  projectKey: "repo",
  projectDisplayName: "Repo",
  lessonKey: "review-verdicts",
  title: "Review verdicts",
  body: "Keep candidate content immutable.",
  rationale: "Corrections must remain auditable.",
  evidence: [{ excerpt: "Let me update a verdict.", commitHashes: ["abc"] }],
  createdAt: start.toISOString(),
};

function setup() {
  const repository = new MemoryReviewRepository();
  const app = createApp({
    repository,
    agentAuth: pass,
    reviewerAuth: pass,
    publicBaseUrl: origin,
    now: () => start,
  });
  return { app, repository };
}

async function seed(repository: MemoryReviewRepository) {
  await repository.createCandidate("candidate-key", candidate);
  return repository.decide(
    candidate.candidateId,
    1,
    { action: "approve" },
    start,
    "owner@example.com",
  );
}

function amend(app: ReturnType<typeof createApp>, body: object, round = "1") {
  return request(app)
    .post(`/api/review/candidates/${candidate.candidateId}/rounds/${round}/amendments`)
    .set("Origin", origin)
    .send(body);
}

describe("decision amendments", () => {
  it("appends a correction and keeps immutable originals with one current pointer", async () => {
    const { app, repository } = setup();
    const approved = await seed(repository);
    const response = await amend(app, {
      expectedDecisionId: approved.decisionId,
      action: "reject",
    });
    expect(response.status).toBe(201);
    expect(response.body.decision).toMatchObject({
      roundKind: "initial",
      effect: "deactivate",
      amendsDecisionId: approved.decisionId,
      isCurrent: true,
      canAmend: true,
      title: candidate.title,
      body: candidate.body,
      projectKey: "repo",
    });

    const history = await repository.history(undefined, 10, "project");
    expect(history.decisions).toHaveLength(2);
    expect(history.decisions[0]).toMatchObject({
      decisionId: approved.decisionId,
      isCurrent: false,
      canAmend: false,
      effect: "activate",
    });
    expect(history.decisions[1].isCurrent).toBe(true);
    expect(await repository.queue(undefined, new Date("2026-08-03"))).toHaveLength(0);
  });

  it("rejects stale, unchanged, malformed, and invalid verdict inputs", async () => {
    const { app, repository } = setup();
    const approved = await seed(repository);
    expect((await amend(app, { expectedDecisionId: cryptoId(), action: "reject" })).status).toBe(409);
    expect((await amend(app, { expectedDecisionId: approved.decisionId, action: "approve" })).status).toBe(400);
    expect((await amend(app, { expectedDecisionId: approved.decisionId, action: "mark_invalid" })).status).toBe(400);
    expect((await amend(app, { expectedDecisionId: approved.decisionId, action: "reject", deferUntil: "2026-07-27T00:00:00Z" })).status).toBe(400);
    expect((await amend(app, { expectedDecisionId: approved.decisionId, action: "defer", deferUntil: "2026-11-01T00:00:00Z" })).status).toBe(400);
    expect((await amend(app, { expectedDecisionId: approved.decisionId, action: "defer" })).status).toBe(400);
    expect((await amend(app, { expectedDecisionId: approved.decisionId, action: "reject", title: "Changed" })).status).toBe(400);
    expect((await amend(app, { action: "reject" })).status).toBe(400);
    expect((await amend(app, { expectedDecisionId: approved.decisionId, action: "reject" }, "1.0")).status).toBe(400);
    expect((await amend(app, { expectedDecisionId: approved.decisionId, action: "reject" }, "0")).status).toBe(400);
    expect(await repository.queue(undefined, new Date("2026-08-02T00:00:00Z"))).toMatchObject([{round:2,kind:"scheduled"}]);
  });

  it("rebuilds only an undecided successor and rejects decided descendants", async () => {
    const { app, repository } = setup();
    const approved = await seed(repository);
    const deferred = await amend(app, {
      expectedDecisionId: approved.decisionId,
      action: "defer",
      deferUntil: "2026-07-30T00:00:00Z",
    });
    expect(deferred.status).toBe(201);
    const approvedAgain = await amend(app, {
      expectedDecisionId: deferred.body.decision.decisionId,
      action: "approve",
    });
    expect(approvedAgain.status).toBe(201);
    expect(await repository.queue(undefined, new Date("2026-07-31"))).toHaveLength(0);
    expect(await repository.queue(undefined, new Date("2026-08-02"))).toMatchObject([
      { round: 2, kind: "scheduled" },
    ]);

    const roundTwo = await repository.decide(
      candidate.candidateId,
      2,
      { action: "mark_invalid" },
      new Date("2026-08-02T00:00:00Z"),
      "owner@example.com",
    );
    expect(roundTwo.effect).toBe("deactivate");
    expect(
      (
        await amend(app, {
          expectedDecisionId: approvedAgain.body.decision.decisionId,
          action: "reject",
        })
      ).status,
    ).toBe(409);
  });

  it("counts only authoritative confirmations when rebuilding schedules", async () => {
    const { repository } = setup();
    const approved = await seed(repository);
    const confirmed = await repository.decide(
      candidate.candidateId,
      2,
      { action: "confirm_valid" },
      new Date(approved.nextReviewAt!),
      "owner@example.com",
    );
    const invalid = await repository.amendDecision(
      candidate.candidateId,
      2,
      { expectedDecisionId: confirmed.decisionId, action: "mark_invalid" },
      new Date("2026-08-03T00:00:00Z"),
      "owner@example.com",
    );
    const restored = await repository.amendDecision(
      candidate.candidateId,
      2,
      { expectedDecisionId: invalid.decisionId, action: "confirm_valid" },
      new Date("2026-08-04T00:00:00Z"),
      "owner@example.com",
    );
    expect(restored.nextReviewAt).toBe("2026-09-03T00:00:00.000Z");
  });

  it("keeps global amendment metadata free of project identity", async () => {
    const repository = new MemoryReviewRepository();
    const globalCandidate = {
      ...candidate,
      candidateId: "33333333-3333-4333-8333-333333333333",
      scope: "global" as const,
      projectKey: undefined,
      projectDisplayName: undefined,
    };
    await repository.createCandidate("global-key", globalCandidate);
    const rejected = await repository.decide(
      globalCandidate.candidateId,
      1,
      { action: "reject" },
      start,
      "owner@example.com",
    );
    const amended = await repository.amendDecision(
      globalCandidate.candidateId,
      1,
      { expectedDecisionId: rejected.decisionId, action: "approve" },
      start,
      "owner@example.com",
    );
    expect(amended).toMatchObject({ scope: "global", effect: "activate" });
    expect(amended).not.toHaveProperty("projectKey");
    expect(amended).not.toHaveProperty("projectDisplayName");
  });
});

function cryptoId() {
  return "22222222-2222-4222-8222-222222222222";
}
