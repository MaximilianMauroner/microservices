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
      "Cloudflare Access protects this review desk",
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

  it("promotes and demotes undecided candidates using their recorded origin project", async () => {
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
      json: { idempotencyKey: "scope-key", candidate },
    });
    const path = `/api/review/candidates/${candidate.candidateId}/rounds/1/scope`;
    const promote = await callApp(app, path, {
      method: "POST",
      headers: { Origin: origin },
      json: { scope: "global" },
    });
    expect(promote.status).toBe(200);
    expect(await responseJson(promote)).toMatchObject({
      candidate: {
        scope: "global",
        foundProjectKey: "repo",
        foundProjectDisplayName: "Repo",
        scopeChangedBy: "owner@example.com",
      },
    });
    expect((await repository.queue("project", new Date())).length).toBe(0);
    expect((await repository.queue("global", new Date()))[0]?.candidate)
      .not.toHaveProperty("projectKey");

    const demote = await callApp(app, path, {
      method: "POST",
      headers: { Origin: origin },
      json: { scope: "project" },
    });
    expect(await responseJson(demote)).toMatchObject({
      candidate: {
        scope: "project",
        projectKey: "repo",
        projectDisplayName: "Repo",
        foundProjectKey: "repo",
      },
    });

    await callApp(
      app,
      `/api/review/candidates/${candidate.candidateId}/rounds/1/verdict`,
      {
        method: "POST",
        headers: { Origin: origin },
        json: { action: "approve" },
      },
    );
    expect(
      (
        await callApp(app, path, {
          method: "POST",
          headers: { Origin: origin },
          json: { scope: "global" },
        })
      ).status,
    ).toBe(409);
  });

  it("refuses to demote a global candidate with no associated project", async () => {
    const { app } = setup();
    const globalCandidate = {
      ...candidate,
      candidateId: "22222222-2222-4222-8222-222222222222",
      scope: "global" as const,
      projectKey: undefined,
      projectDisplayName: undefined,
    };
    await callApp(app, "/api/agent/candidates", {
      method: "POST",
      json: { idempotencyKey: "global-key", candidate: globalCandidate },
    });
    const response = await callApp(
      app,
      `/api/review/candidates/${globalCandidate.candidateId}/rounds/1/scope`,
      {
        method: "POST",
        headers: { Origin: origin },
        json: { scope: "project" },
      },
    );
    expect(response.status).toBe(400);
    expect(await responseJson(response)).toEqual({
      error: "invalid_request",
      message: "This candidate has no associated project to demote to.",
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

    for (const primitive of [null, "lesson", 42, true]) {
      const response = await callApp(app, "/api/agent/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(primitive),
      });
      expect(response.status).toBe(400);
      expect(await responseJson(response)).toMatchObject({
        error: "invalid_request",
      });
      expect(authenticationCalls).toBe(0);
    }

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

    const emptyBeforeAuth = await callApp(app, "/api/agent/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });
    expect(emptyBeforeAuth.status).toBe(401);
    expect(authenticationCalls).toBe(1);

    const { app: authenticatedApp } = setup();
    const emptyValidated = await callApp(
      authenticatedApp,
      "/api/agent/candidates",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(emptyValidated.status).toBe(400);
    expect(await responseJson(emptyValidated)).toEqual({
      error: "invalid_request",
      message: "JSON object required.",
    });
  });

  it("supports HEAD, case-insensitive routes, and one optional trailing slash", async () => {
    const { app } = setup();
    const getHealth = await callApp(app, "/HeAlTh/");
    const headHealth = await callApp(app, "/HeAlTh/", { method: "HEAD" });
    expect(headHealth.status).toBe(getHealth.status);
    expect([...headHealth.headers]).toEqual([...getHealth.headers]);
    expect(await headHealth.text()).toBe("");

    const protectedGet = await callApp(
      app,
      "/API/ReViEw/QuEuE/?scope=project",
    );
    const protectedHead = await callApp(
      app,
      "/API/ReViEw/QuEuE/?scope=project",
      { method: "HEAD" },
    );
    expect(protectedHead.status).toBe(protectedGet.status);
    expect([...protectedHead.headers]).toEqual([...protectedGet.headers]);
    expect(await protectedHead.text()).toBe("");

    expect(
      (
        await callApp(app, "/API/AGENT/CANDIDATES/", {
          method: "POST",
          json: { idempotencyKey: "case-key", candidate },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await callApp(
          app,
          `/API/REVIEW/CANDIDATES/${candidate.candidateId}/ROUNDS/1/VeRdIcT/`,
          {
            method: "POST",
            headers: { Origin: origin },
            json: { action: "approve" },
          },
        )
      ).status,
    ).toBe(201);
  });

  it("applies auth to mixed-case protected prefixes but keeps segment boundaries exact", async () => {
    let authenticationCalls = 0;
    const reject: Authenticator = () => {
      authenticationCalls += 1;
      return {
        ok: false,
        response: jsonResponse({ error: "unauthorized" }, { status: 401 }),
      };
    };
    const { app } = setup(reject);
    const protectedHead = await callApp(app, "/API/AGENT/DECISIONS/", {
      method: "HEAD",
    });
    expect(protectedHead.status).toBe(401);
    expect(await protectedHead.text()).toBe("");
    expect(authenticationCalls).toBe(1);
    expect((await callApp(app, "/API/AGENT/unknown/")).status).toBe(401);
    expect(authenticationCalls).toBe(2);
    expect((await callApp(app, "/API/AGENTISH/unknown")).status).toBe(404);
    expect(authenticationCalls).toBe(2);
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
    expect(
      (
        await callApp(
          app,
          `/api/review/candidates/${candidate.candidateId}/rounds/1/scope`,
          {
            method: "POST",
            headers: { Origin: "https://attacker.example" },
            json: { scope: "global" },
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

  it("has no agent-side candidate mutation APIs", async () => {
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
