import { expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { MemoryReviewRepository } from "../src/memory-repository.js";
import { callApp, passAuth } from "./http-test.js";

it("uses configured HTTPS origin instead of untrusted proxy or Host headers", async () => {
  const repository = new MemoryReviewRepository();
  const app = createApp({
    repository,
    agentAuth: passAuth,
    reviewerAuth: passAuth,
    publicBaseUrl: "https://reviews.example",
    now: () => new Date("2026-07-26T00:00:00Z"),
  });
  const candidate = {
    candidateId: "11111111-1111-4111-8111-111111111111",
    scope: "global" as const,
    lessonKey: "x",
    title: "x",
    body: "x",
    rationale: "x",
    evidence: [{ excerpt: "x", commitHashes: [] }],
    createdAt: "2026-07-26T00:00:00Z",
  };
  await callApp(app, "/api/agent/candidates", {
    method: "POST",
    json: { idempotencyKey: "k", candidate },
  });
  const path =
    "/api/review/candidates/11111111-1111-4111-8111-111111111111/rounds/1/verdict";
  const response = await callApp(app, path, {
    method: "POST",
    headers: {
      Host: "attacker.example",
      Origin: "https://reviews.example",
      "X-Forwarded-Proto": "http",
    },
    json: { action: "approve" },
  });
  expect(response.status).toBe(201);
});
