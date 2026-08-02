import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { MemoryReviewRepository } from "../src/memory-repository.js";
import { callApp, passAuth, responseJson } from "./http-test.js";

const origin = "https://reviews.example";
const now = new Date("2026-08-02T12:00:00.000Z");
const record = {
  schemaVersion: 1 as const,
  decisionRecordId: "11111111-1111-4111-8111-111111111111",
  taskId: "task-42",
  scope: "project" as const,
  projectKey: "microservices",
  projectDisplayName: "Microservices",
  summary: "Preserve harness-native skills",
  context: "The target contains capabilities owned by another system.",
  options: [
    { label: "Replace everything", rejectedBecause: "Deletes unmanaged skills" },
    { label: "Replace fleet-owned entries" },
  ],
  choice: "Replace fleet-owned entries",
  rationale: "This preserves ownership boundaries.",
  consequences: ["Stale canonical links need explicit removal"],
  confidence: "high" as const,
  evidence: [{ excerpt: "Bounded evidence", commitHashes: ["abc123"] }],
  device: "coding-vm",
  harness: "codex",
  skill: "decision-records",
  createdAt: "2026-08-02T11:00:00.000Z",
};

function setup(decisionRecordArchiveDays = 90) {
  const repository = new MemoryReviewRepository();
  return {
    repository,
    app: createApp({
      repository,
      agentAuth: passAuth,
      reviewerAuth: () => ({ ok: true, email: "max@example.com" }),
      publicBaseUrl: origin,
      now: () => now,
      decisionRecordArchiveDays,
    }),
  };
}

describe("decision record review", () => {
  it("ingests records idempotently and exposes the unresolved task inbox", async () => {
    const { app } = setup();
    const body = { idempotencyKey: record.decisionRecordId, record };
    expect((await callApp(app, "/api/agent/decision-records", { method: "POST", json: body })).status).toBe(201);
    expect((await callApp(app, "/api/agent/decision-records", { method: "POST", json: body })).status).toBe(200);
    expect((await callApp(app, "/api/agent/decision-records", {
      method: "POST",
      json: { ...body, record: { ...record, summary: "Changed" } },
    })).status).toBe(409);

    const response = await callApp(app, "/api/review/decision-records?reviewState=unreviewed&projectKey=microservices");
    expect(await responseJson(response)).toMatchObject({
      pending: 1,
      hasMore: false,
      items: [{ record: { taskId: "task-42", choice: "Replace fleet-owned entries" }, feedbackHistory: [] }],
    });
  });

  it("bounds decision record ingestion independently from the existing agent API", async () => {
    const repository = new MemoryReviewRepository();
    const app = createApp({ repository, agentAuth: passAuth, reviewerAuth: passAuth, publicBaseUrl: origin, now: () => now, decisionRecordRateLimitPerMinute: 1 });
    expect((await callApp(app, "/api/agent/decision-records", { method: "POST", json: { idempotencyKey: "one", record } })).status).toBe(201);
    const limited = await callApp(app, "/api/agent/decision-records", { method: "POST", json: { idempotencyKey: "two", record: { ...record, decisionRecordId: crypto.randomUUID() } } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  it.each([
    [0, 400],
    [1, 400],
    [2, 201],
    [10, 201],
    [11, 400],
  ])("enforces the 2-10 option boundary (%i)", async (count, status) => {
    const { app } = setup();
    const response = await callApp(app, "/api/agent/decision-records", {
      method: "POST",
      json: {
        idempotencyKey: crypto.randomUUID(),
        record: {
          ...record,
          decisionRecordId: crypto.randomUUID(),
          options: Array.from({ length: count }, (_, index) => ({ label: `Option ${index + 1}` })),
        },
      },
    });
    expect(response.status).toBe(status);
  });

  it("rejects secret-like values and private URLs", async () => {
    const { app } = setup();
    for (const context of [
      "token=super-secret-value-12345",
      "See http://192.168.1.12/internal",
      "See http://169.254.169.254/latest/meta-data",
      "See http://100.64.0.1/internal",
      "See http://[::1]/internal",
      "See http://[fd00::1]/internal",
      "See http://[fe80::1]/internal",
      "See http://metadata.google.internal/computeMetadata/v1",
      "See http://intranet/service",
      "See http://user:password@example.com/private",
    ]) {
      const response = await callApp(app, "/api/agent/decision-records", {
        method: "POST",
        json: { idempotencyKey: crypto.randomUUID(), record: { ...record, decisionRecordId: crypto.randomUUID(), context } },
      });
      expect(response.status).toBe(400);
      expect(await responseJson(response)).toMatchObject({ error: "invalid_request" });
    }
    expect((await callApp(app, "/api/agent/decision-records", {
      method: "POST",
      json: {
        idempotencyKey: "public-url",
        record: { ...record, decisionRecordId: crypto.randomUUID(), context: "See https://example.com/reference and https://[2606:4700:4700::1111]/dns-query" },
      },
    })).status).toBe(201);
    await callApp(app, "/api/agent/decision-records", {
      method: "POST",
      json: { idempotencyKey: "record", record },
    });
    const feedback = await callApp(app, `/api/review/decision-records/${record.decisionRecordId}/feedback`, {
      method: "POST",
      headers: { Origin: origin },
      json: { action: "down", comment: "password=super-secret-value-123" },
    });
    expect(feedback.status).toBe(400);
  });

  it("uses configured retention for list and detail archive flags", async () => {
    const { app, repository } = setup(30);
    await repository.createDecisionRecord("record", record);
    await repository.addDecisionFeedback(
      record.decisionRecordId,
      { action: "up" },
      new Date(now.getTime() - 45 * 86_400_000),
      "max@example.com",
    );
    const normal = await responseJson<{ items: unknown[] }>(
      await callApp(app, "/api/review/decision-records?reviewState=reviewed"),
    );
    expect(normal.items).toEqual([]);
    const archived = await responseJson<{ items: Array<{ archived: boolean }> }>(
      await callApp(app, "/api/review/decision-records?reviewState=reviewed&includeArchived=true"),
    );
    expect(archived.items[0]?.archived).toBe(true);
    const detail = await responseJson<{ archived: boolean }>(
      await callApp(app, `/api/review/decision-records/${record.decisionRecordId}`),
    );
    expect(detail.archived).toBe(true);
  });

  it("keeps feedback revisions auditable without mutating submitted content", async () => {
    const { app } = setup();
    await callApp(app, "/api/agent/decision-records", {
      method: "POST",
      json: { idempotencyKey: "record", record },
    });
    const path = `/api/review/decision-records/${record.decisionRecordId}/feedback`;
    const first = await callApp(app, path, {
      method: "POST",
      headers: { Origin: origin },
      json: { action: "up", comment: "Reasonable for this task." },
    });
    expect(first.status).toBe(201);
    const firstFeedback = (await responseJson<{ feedback: { feedbackId: string } }>(first)).feedback;
    expect((await callApp(app, path, {
      method: "POST",
      headers: { Origin: origin },
      json: { action: "down" },
    })).status).toBe(409);

    const amended = await callApp(app, path, {
      method: "POST",
      headers: { Origin: origin },
      json: { action: "down", comment: "Do not repeat globally.", expectedFeedbackId: firstFeedback.feedbackId },
    });
    expect(amended.status).toBe(201);
    const detail = await responseJson<{
      record: typeof record;
      currentFeedback: { action: string };
      feedbackHistory: Array<{ action: string; amendsFeedbackId?: string }>;
    }>(await callApp(app, `/api/review/decision-records/${record.decisionRecordId}`));
    expect(detail.record).toEqual(record);
    expect(detail.currentFeedback.action).toBe("down");
    expect(detail.feedbackHistory).toEqual([
      expect.objectContaining({ action: "up" }),
      expect.objectContaining({ action: "down", amendsFeedbackId: firstFeedback.feedbackId }),
    ]);
  });

  it("promotes reviewed records into the existing inactive candidate queue", async () => {
    const { app } = setup();
    await callApp(app, "/api/agent/decision-records", { method: "POST", json: { idempotencyKey: "record", record } });
    await callApp(app, `/api/review/decision-records/${record.decisionRecordId}/feedback`, {
      method: "POST",
      headers: { Origin: origin },
      json: { action: "down", comment: "Preserve unmanaged entries." },
    });
    const candidate = {
      candidateId: "22222222-2222-4222-8222-222222222222",
      scope: "project",
      projectKey: "microservices",
      projectDisplayName: "Microservices",
      lessonKey: "preserve-ownership-boundaries",
      title: "Preserve unmanaged skill entries",
      body: "Replace only fleet-owned skill entries.",
      rationale: "Harness-native capabilities have a separate owner.",
      createdAt: now.toISOString(),
    };
    const promotionBody = { idempotencyKey: "promotion-1", decisionRecordIds: [record.decisionRecordId], candidate };
    const promote = () => callApp(app, "/api/review/decision-records/promotions", {
      method: "POST",
      headers: { Origin: origin },
      json: promotionBody,
    });
    expect((await promote()).status).toBe(201);
    expect((await promote()).status).toBe(200);

    const queue = await responseJson<{ items: Array<{ candidate: { candidateId: string } }> }>(
      await callApp(app, "/api/review/queue?scope=project"),
    );
    expect(queue.items.map((item) => item.candidate.candidateId)).toContain(candidate.candidateId);
    const detail = await responseJson<{ promotionCandidateId: string }>(
      await callApp(app, `/api/review/decision-records/${record.decisionRecordId}`),
    );
    expect(detail.promotionCandidateId).toBe(candidate.candidateId);
  });
});
