import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { MemoryReviewRepository } from "../src/memory-repository.js";

const pass: RequestHandler = (_req, _res, next) => next();
const candidate = { candidateId: "c1", scope: "project" as const, projectKey: "repo", projectDisplayName: "Repo", lessonKey: "tests", title: "Run tests", body: "Run focused tests.", rationale: "Correction", evidence: [{ excerpt: "Please run tests", commitHashes: ["abc123"] }], createdAt: "2026-07-26T00:00:00.000Z" };
function setup() { const repository = new MemoryReviewRepository(); return { repository, app: createApp({ repository, agentAuth: pass, reviewerAuth: pass, now: () => new Date("2026-07-26T00:00:00Z") }) }; }

describe("field guide review", () => {
  it("keeps immutable candidates idempotent", async () => {
    const { app } = setup(); const body = { idempotencyKey: "k1", candidate };
    expect((await request(app).post("/api/agent/candidates").send(body)).status).toBe(201);
    expect((await request(app).post("/api/agent/candidates").send(body)).status).toBe(200);
    expect((await request(app).post("/api/agent/candidates").send({ ...body, candidate: { ...candidate, title: "Changed" } })).status).toBe(409);
    expect((await request(app).get("/api/review/queue?scope=project")).body.items).toHaveLength(1);
  });
  it("schedules reviews and prevents conflicting verdicts", async () => {
    const { app } = setup(); await request(app).post("/api/agent/candidates").send({ idempotencyKey: "k", candidate });
    const post = () => request(app).post("/api/review/candidates/c1/rounds/1/verdict").set("Host", "reviews.example").set("Origin", "http://reviews.example").send({ action: "approve" });
    const first = await post(); expect(first.status).toBe(201); expect(first.body.decision.nextReviewAt).toBe("2026-08-02T00:00:00.000Z");
    expect((await post()).status).toBe(409);
    expect((await request(app).get("/api/agent/decisions?limit=1")).body.decisions).toHaveLength(1);
  });
  it("has no mutation APIs", async () => { const { app } = setup(); expect((await request(app).patch("/api/agent/candidates/c1")).status).toBe(404); expect((await request(app).delete("/api/agent/candidates/c1")).status).toBe(404); });
});
