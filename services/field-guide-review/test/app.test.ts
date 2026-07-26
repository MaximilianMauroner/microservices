import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { Authenticator } from "../src/http.js";
import { jsonResponse } from "../src/http.js";
import { MemoryReviewRepository } from "../src/memory-repository.js";
import { callApp, passAuth, responseJson } from "./http-test.js";

const origin = "https://reviews.example";
const candidate = {
  candidateId: "11111111-1111-4111-8111-111111111111",
  scope: "project" as const,
  projectKey: "repo",
  projectDisplayName: "Repo",
  lessonKey: "tests",
  title: "Run tests",
  body: "Run focused tests.",
  rationale: "Correction",
  evidence: [{ excerpt: "Please run tests", commitHashes: ["abc123"] }],
  createdAt: "2026-07-26T00:00:00.000Z",
};

function setup(authentication: Authenticator = passAuth) {
  const repository = new MemoryReviewRepository();
  return {
    repository,
    app: createApp({
      repository,
      agentAuth: authentication,
      reviewerAuth: authentication,
      publicBaseUrl: origin,
      stylesheet: new Blob([".review-card{display:block}"]),
      now: () => new Date("2026-07-26T00:00:00Z"),
    }),
  };
}

describe("field guide review transport", () => {
  it("serves public routes and deterministic not-found responses", async () => {
    const { app } = setup();
    const health = await callApp(app, "/health");
    expect(health.status).toBe(200);
    expect(health.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(await responseJson(health)).toEqual({ ok: true });

    const root = await callApp(app, "/");
    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("/review");
    expect((await callApp(app, "/review")).headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(await (await callApp(app, "/review/callback")).text()).toContain(
      "data-shoo-callback-path",
    );
    const css = await callApp(app, "/review.css");
    expect(css.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await css.text()).toContain("review-card");

    const apiMissing = await callApp(app, "/api/missing");
    expect(apiMissing.status).toBe(404);
    expect(await responseJson(apiMissing)).toMatchObject({ error: "not_found" });
    const pageMissing = await callApp(app, "/missing");
    expect(pageMissing.status).toBe(404);
    expect(await pageMissing.text()).toBe("Route not found.");
  });

  it("keeps immutable candidates idempotent", async () => {
    const { app } = setup();
    const body = { idempotencyKey: "k1", candidate };
    expect(
      (await callApp(app, "/api/agent/candidates", { method: "POST", json: body }))
        .status,
    ).toBe(201);
    expect(
      (await callApp(app, "/api/agent/candidates", { method: "POST", json: body }))
        .status,
    ).toBe(200);
    expect(
      (
        await callApp(app, "/api/agent/candidates", {
          method: "POST",
          json: { ...body, candidate: { ...candidate, title: "Changed" } },
        })
      ).status,
    ).toBe(409);
    const queue = await callApp(app, "/api/review/queue?scope=project");
    expect(await responseJson<{ items: unknown[] }>(queue)).toMatchObject({
      items: [expect.anything()],
    });
  });

  it("schedules reviews, records the authenticated reviewer, and prevents conflicting verdicts", async () => {
    const reviewerAuth: Authenticator = () => ({
      ok: true,
      email: "owner@example.com",
    });
    const repository = new MemoryReviewRepository();
    const app = createApp({
      repository,
      agentAuth: passAuth,
      reviewerAuth,
      publicBaseUrl: origin,
      now: () => new Date("2026-07-26T00:00:00Z"),
    });
    await callApp(app, "/api/agent/candidates", {
      method: "POST",
      json: { idempotencyKey: "k", candidate },
    });
    const path = `/api/review/candidates/${candidate.candidateId}/rounds/1/verdict`;
    const post = () =>
      callApp(app, path, {
        method: "POST",
        headers: { Origin: origin },
        json: { action: "approve" },
      });
    const first = await post();
    expect(first.status).toBe(201);
    expect(
      await responseJson<{
        decision: { nextReviewAt: string; reviewer: string };
      }>(first),
    ).toMatchObject({
      decision: {
        nextReviewAt: "2026-08-02T00:00:00.000Z",
        reviewer: "owner@example.com",
      },
    });
    expect((await post()).status).toBe(409);
    const decisions = await callApp(app, "/api/agent/decisions?limit=1");
    expect(await responseJson<{ decisions: unknown[] }>(decisions)).toMatchObject({
      decisions: [expect.anything()],
    });
  });

  it("parses JSON and enforces its actual streamed byte limit before authentication", async () => {
    let authenticationCalls = 0;
    const reject: Authenticator = () => {
      authenticationCalls += 1;
      return {
        ok: false,
        response: jsonResponse({ error: "unauthorized" }, { status: 401 }),
      };
    };
    const { app } = setup(reject);
    const malformed = await callApp(app, "/api/agent/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/problem+json; charset=utf-8" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(authenticationCalls).toBe(0);

    const oversized = await callApp(app, "/api/agent/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "€".repeat(44_000) }),
    });
    expect(oversized.status).toBe(413);
    expect(authenticationCalls).toBe(0);
    expect(await responseJson(oversized)).toEqual({
      error: "payload_too_large",
      message: "JSON body exceeds 128 KiB.",
    });
  });

  it("authenticates protected prefixes before origin checks and prefix 404s", async () => {
    const reject: Authenticator = () => ({
      ok: false,
      response: jsonResponse({ error: "unauthorized" }, { status: 401 }),
    });
    const { app } = setup(reject);
    expect((await callApp(app, "/api/agent/not-a-route")).status).toBe(401);
    expect(
      (
        await callApp(
          app,
          `/api/review/candidates/${candidate.candidateId}/rounds/1/verdict`,
          {
            method: "POST",
            headers: { Origin: "https://attacker.example" },
            json: { action: "approve" },
          },
        )
      ).status,
    ).toBe(401);
  });

  it("preserves non-JSON validation, rejects duplicate queries, unsafe paths, and bad origins", async () => {
    const { app } = setup();
    expect(
      (
        await callApp(app, "/api/agent/candidates", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "{}",
        })
      ).status,
    ).toBe(400);
    expect(
      (await callApp(app, "/api/review/queue?scope=project&scope=global")).status,
    ).toBe(400);
    expect(
      (await callApp(app, "/api/review/history?limit=1&limit=2")).status,
    ).toBe(400);
    const malformedPath = await callApp(
      app,
      "/api/review/candidates/%/rounds/1/verdict",
      {
        method: "POST",
        headers: { Origin: origin },
        json: { action: "approve" },
      },
    );
    expect(malformedPath.status).toBe(400);
    expect(await responseJson(malformedPath)).toEqual({
      error: "invalid_request",
      message: "Invalid path parameter.",
    });
    expect(
      (
        await callApp(
          app,
          `/api/review/candidates/${candidate.candidateId}/rounds/1/verdict`,
          {
            method: "POST",
            headers: { Origin: "https://attacker.example" },
            json: { action: "approve" },
          },
        )
      ).status,
    ).toBe(403);
  });

  it("maps unexpected repository failures without exposing details", async () => {
    const { app, repository } = setup();
    vi.spyOn(repository, "queue").mockRejectedValueOnce(new Error("secret"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await callApp(app, "/api/review/queue");
    expect(response.status).toBe(500);
    expect(await responseJson(response)).toEqual({
      error: "internal_error",
      message: "Request failed.",
    });
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it("has no candidate mutation APIs", async () => {
    const { app } = setup();
    expect(
      (await callApp(app, "/api/agent/candidates/c1", { method: "PATCH" }))
        .status,
    ).toBe(404);
    expect(
      (await callApp(app, "/api/agent/candidates/c1", { method: "DELETE" }))
        .status,
    ).toBe(404);
  });
});
