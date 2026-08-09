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

  it("preserves source-project identity for global task grouping and promotion", async () => {
    const { app } = setup();
    const globalRecord = {
      ...record,
      decisionRecordId: crypto.randomUUID(),
      scope: "global" as const,
      projectKey: undefined,
      projectDisplayName: undefined,
      foundProjectKey: "max/example",
      foundProjectDisplayName: "example",
    };
    expect((await callApp(app, "/api/agent/decision-records", {
      method: "POST",
      json: { idempotencyKey: globalRecord.decisionRecordId, record: globalRecord },
    })).status).toBe(201);
    const detail = await responseJson<{ record: typeof globalRecord }>(
      await callApp(app, `/api/review/decision-records/${globalRecord.decisionRecordId}`),
    );
    expect(detail.record).toMatchObject({
      taskId: record.taskId,
      foundProjectKey: "max/example",
      foundProjectDisplayName: "example",
    });
    const filtered = await responseJson<{ items: Array<{ record: { decisionRecordId: string } }> }>(
      await callApp(app, "/api/review/decision-records?projectKey=max%2Fexample"),
    );
    expect(filtered.items.map((item) => item.record.decisionRecordId)).toEqual([
      globalRecord.decisionRecordId,
    ]);

    const missingProvenance = await callApp(app, "/api/agent/decision-records", {
      method: "POST",
      json: {
        idempotencyKey: crypto.randomUUID(),
        record: {
          ...globalRecord,
          decisionRecordId: crypto.randomUUID(),
          foundProjectKey: undefined,
          foundProjectDisplayName: undefined,
        },
      },
    });
    expect(missingProvenance.status).toBe(400);
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
      'password: "super-secret-value-12345"',
      "secret: 'super-secret-value-12345'",
      'api_key: "super-secret-value-12345"',
      "See http://192.168.1.12/internal",
      "See http://192.0.2.10/internal",
      "See http://169.254.169.254/latest/meta-data",
      "See http://100.64.0.1/internal",
      "See http://[::1]/internal",
      "See http://[fd00::1]/internal",
      "See http://[fe80::1]/internal",
      "See http://metadata.google.internal/computeMetadata/v1",
      "See http://service.corp/internal",
      "See http://router.home.arpa/internal",
      "See http://127.1/internal",
      "See http://0x7f.0.0.1/internal",
      "See http://intranet/service",
      "See http://user:password@example.com/private",
      "Do not expose http://127.0.0.1). in output",
      "Do not expose https://[::1]. in output",
      "Do not redirect through https://example.com/?next=http://127.0.0.1/admin",
      "Do not embed https://example.com/http://service.corp/internal",
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
      json: { action: "down", comment: 'password: "super-secret-value-123"' },
    });
    expect(feedback.status).toBe(400);

    await callApp(app, `/api/review/decision-records/${record.decisionRecordId}/feedback`, {
      method: "POST",
      headers: { Origin: origin },
      json: { action: "up" },
    });
    const promotion = await callApp(app, "/api/review/decision-records/promotions", {
      method: "POST",
      headers: { Origin: origin },
      json: {
        idempotencyKey: "quoted-secret-promotion",
        decisionRecordIds: [record.decisionRecordId],
        candidate: {
          candidateId: crypto.randomUUID(),
          scope: "project",
          projectKey: "microservices",
          projectDisplayName: "Microservices",
          lessonKey: "never-store-secrets",
          title: "Never store secrets",
          body: "Keep credentials out of decision records.",
          rationale: 'token: "super-secret-value-123"',
          createdAt: now.toISOString(),
        },
      },
    });
    expect(promotion.status).toBe(400);

    for (const idempotencyKey of [
      "token=super-secret-value-12345",
      "http://169.254.169.254/latest/meta-data",
      "http://service.corp/internal",
    ]) {
      const rejectedRecord = await callApp(app, "/api/agent/decision-records", {
        method: "POST",
        json: { idempotencyKey, record: { ...record, decisionRecordId: crypto.randomUUID() } },
      });
      expect(rejectedRecord.status).toBe(400);
      const rejectedPromotion = await callApp(app, "/api/review/decision-records/promotions", {
        method: "POST",
        headers: { Origin: origin },
        json: {
          idempotencyKey,
          decisionRecordIds: [record.decisionRecordId],
          candidate: {
            candidateId: crypto.randomUUID(),
            scope: "project",
            projectKey: "microservices",
            projectDisplayName: "Microservices",
            lessonKey: "safe-key",
            title: "Safe title",
            body: "Safe body",
            rationale: "Safe rationale",
            createdAt: now.toISOString(),
          },
        },
      });
      expect(rejectedPromotion.status).toBe(400);
    }
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
    const detailBeforeAmendment = await responseJson<{ currentFeedback: { feedbackId: string } }>(
      await callApp(app, `/api/review/decision-records/${record.decisionRecordId}`),
    );
    await callApp(app, `/api/review/decision-records/${record.decisionRecordId}/feedback`, {
      method: "POST",
      headers: { Origin: origin },
      json: {
        action: "up",
        comment: "A later re-frame must not change promotion identity.",
        expectedFeedbackId: detailBeforeAmendment.currentFeedback.feedbackId,
      },
    });
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

  it("rejects a global promotion assembled from different source projects", async () => {
    const { app } = setup();
    const records = [
      { ...record, decisionRecordId: crypto.randomUUID() },
      {
        ...record,
        decisionRecordId: crypto.randomUUID(),
        scope: "global" as const,
        projectKey: undefined,
        projectDisplayName: undefined,
        foundProjectKey: "another/repository",
        foundProjectDisplayName: "repository",
      },
    ];
    for (const value of records) {
      await callApp(app, "/api/agent/decision-records", {
        method: "POST",
        json: { idempotencyKey: value.decisionRecordId, record: value },
      });
      await callApp(app, `/api/review/decision-records/${value.decisionRecordId}/feedback`, {
        method: "POST",
        headers: { Origin: origin },
        json: { action: "up" },
      });
    }
    const response = await callApp(app, "/api/review/decision-records/promotions", {
      method: "POST",
      headers: { Origin: origin },
      json: {
        idempotencyKey: crypto.randomUUID(),
        decisionRecordIds: records.map((value) => value.decisionRecordId),
        candidate: {
          candidateId: crypto.randomUUID(),
          scope: "global",
          lessonKey: "shared-source-only",
          title: "Keep one source project",
          body: "Do not erase provenance.",
          rationale: "A candidate can store one source project.",
          createdAt: now.toISOString(),
        },
      },
    });
    expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({ message: "Promoted decision records must share one source project." });
  });

  it("rejects project candidate identity that contradicts source provenance", async () => {
    const { app } = setup();
    await callApp(app, "/api/agent/decision-records", {
      method: "POST",
      json: { idempotencyKey: "project-source", record },
    });
    await callApp(app, `/api/review/decision-records/${record.decisionRecordId}/feedback`, {
      method: "POST",
      headers: { Origin: origin },
      json: { action: "up" },
    });
    const response = await callApp(app, "/api/review/decision-records/promotions", {
      method: "POST",
      headers: { Origin: origin },
      json: {
        idempotencyKey: "contradictory-project-name",
        decisionRecordIds: [record.decisionRecordId],
        candidate: {
          candidateId: crypto.randomUUID(),
          scope: "project",
          projectKey: record.projectKey,
          projectDisplayName: "A different repository",
          lessonKey: "source-identity",
          title: "Keep source identity",
          body: "Derive project identity from the source record.",
          rationale: "Client labels cannot rewrite provenance.",
          createdAt: now.toISOString(),
        },
      },
    });
    expect(response.status).toBe(400);
    expect(await responseJson(response)).toMatchObject({
      message: "Project candidate identity must match source project provenance.",
    });
    expect((await responseJson<{ items: unknown[] }>(await callApp(app, "/api/review/queue?scope=project"))).items).toEqual([]);
  });

  it("canonicalizes UUIDs before persistence and promotion duplicate checks", async () => {
    const { app } = setup();
    const lowercaseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const uppercaseId = lowercaseId.toUpperCase();
    const ingested = await callApp(app, "/api/agent/decision-records", {
      method: "POST",
      json: { idempotencyKey: "uppercase-record", record: { ...record, decisionRecordId: uppercaseId } },
    });
    expect(ingested.status).toBe(201);
    expect(await responseJson(ingested)).toMatchObject({ decisionRecordId: lowercaseId });
    const detail = await responseJson<{ record: { decisionRecordId: string } }>(
      await callApp(app, `/api/review/decision-records/${uppercaseId}`),
    );
    expect(detail.record.decisionRecordId).toBe(lowercaseId);
    await callApp(app, `/api/review/decision-records/${uppercaseId}/feedback`, {
      method: "POST",
      headers: { Origin: origin },
      json: { action: "up" },
    });
    const promotion = await callApp(app, "/api/review/decision-records/promotions", {
      method: "POST",
      headers: { Origin: origin },
      json: {
        idempotencyKey: "case-variant-duplicates",
        decisionRecordIds: [lowercaseId, uppercaseId],
        candidate: {
          candidateId: crypto.randomUUID(),
          scope: "project",
          projectKey: "microservices",
          projectDisplayName: "Microservices",
          lessonKey: "canonical-uuids",
          title: "Canonicalize UUIDs",
          body: "Normalize before comparison.",
          rationale: "UUID hex casing is not identity.",
          createdAt: now.toISOString(),
        },
      },
    });
    expect(promotion.status).toBe(400);
    expect(await responseJson(promotion)).toMatchObject({ message: "decisionRecordIds contains duplicates." });
  });
});
