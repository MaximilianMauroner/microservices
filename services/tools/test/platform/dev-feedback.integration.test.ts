import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DISPOSABLE_DATABASE_SENTINEL, withVerifiedDisposableDatabase } from "../../platform/database/postgres-push-guard.js";
import type { PlatformPrincipal } from "#security";
import { devFeedbackRepository, type DevFeedbackRepository } from "../../platform/dev-feedback/dev-feedback.js";
import { handleReportSubmission } from "../../platform/dev-feedback/http.js";
import { githubIssueUrl, parseDevFeedback } from "../../platform/dev-feedback/report.js";
import { requireLoopbackPostgres } from "../harness/postgres.ts";

const databaseUrl = process.env.TEST_DATABASE_URL ? requireLoopbackPostgres(process.env.TEST_DATABASE_URL) : undefined;
const sql = databaseUrl && process.env.TOOLS_TEST_DATABASE_CONFIRM === "tools-platform-test" ? postgres(databaseUrl, { max: 2 }) : undefined;

beforeEach(async () => {
  if (!sql) return;
  await withVerifiedDisposableDatabase({
    readRelationKind: async () => (await sql<{ kind: string }[]>`
      select c.relkind::text kind from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = ${DISPOSABLE_DATABASE_SENTINEL.relation}`)[0]?.kind,
    readValue: async () => (await sql<{ value: string }[]>`
      select sentinel_value value from public.tools_runtime_test_sentinel
      where sentinel_key = ${DISPOSABLE_DATABASE_SENTINEL.key}`)[0]?.value,
  }, async () => { await sql`truncate tools.dev_feedback`; });
});

afterAll(async () => { await sql?.end(); });

describe.skipIf(!sql)("Dev feedback", () => {
  it("lists every person's reports newest first and lets the admin mark one done", async () => {
    const feedback = devFeedbackRepository(sql!);
    await feedback.send({ app: "tools", kind: "bug", message: "The plan page is blank", page: "/kitchen/plan" }, { subject: "member-sub", email: "friend@example.com" });
    await feedback.send({ app: "pantrino", kind: "feature", message: "Export the shopping list", details: "I shop with my partner", page: "/shopping", context: "Pantrino 1.2.0 (14) · iOS 26.1", contactEmail: "guest@example.com" }, undefined);

    const [newest, oldest] = await feedback.list();
    expect([newest?.message, oldest?.message]).toEqual(["Export the shopping list", "The plan page is blank"]);
    expect(oldest).toMatchObject({ app: "tools", kind: "bug", page: "/kitchen/plan", authorEmail: "friend@example.com", state: "open" });
    expect(newest).toMatchObject({ app: "pantrino", details: "I shop with my partner", context: "Pantrino 1.2.0 (14) · iOS 26.1", contactEmail: "guest@example.com" });
    expect(newest?.authorEmail).toBeUndefined();
    expect(await feedback.countOpen()).toBe(2);

    expect(await feedback.setState(newest!.id, "tracked")).toBe(true);
    expect(await feedback.setState(oldest!.id, "done")).toBe(true);
    expect(await feedback.countOpen()).toBe(0);
    expect((await feedback.list()).find((item) => item.id === oldest!.id)?.state).toBe("done");
    expect(await feedback.setState(randomUUID(), "done")).toBe(false);
    expect(await feedback.setState("not-an-id", "done")).toBe(false);
  });
});

describe("dev feedback input", () => {
  it("keeps a trimmed message and only same-site page paths", () => {
    expect(parseDevFeedback({ kind: "feature", message: "  Dark plan view  ", page: "/kitchen/plan?week=2026-11-02" })).toEqual({ app: "tools", kind: "feature", message: "Dark plan view", page: "/kitchen/plan?week=2026-11-02" });
    expect(parseDevFeedback({ kind: "bug", message: "x", page: "//evil.example" }).page).toBe("/");
    expect(parseDevFeedback({ kind: "bug", message: "x", page: "javascript:alert(1)" }).page).toBe("/");
  });

  it("accepts a known app with its device context and an optional contact email", () => {
    expect(parseDevFeedback({ app: "pantrino", kind: "bug", message: "Crash", page: "/plan", context: " Pantrino 1.2.0 · Android 16 ", contactEmail: " me@example.com " }))
      .toEqual({ app: "pantrino", kind: "bug", message: "Crash", page: "/plan", context: "Pantrino 1.2.0 · Android 16", contactEmail: "me@example.com" });
    expect(parseDevFeedback({ app: "dotally", kind: "bug", message: "x", details: "  ", page: "/" })).toEqual({ app: "dotally", kind: "bug", message: "x", page: "/" });
    expect(() => parseDevFeedback({ app: "other", kind: "bug", message: "x", page: "/" })).toThrow();
    expect(() => parseDevFeedback({ kind: "bug", message: "x", page: "/", contactEmail: "not-an-email" })).toThrow();
  });

  it("prefills a GitHub issue without the reporter's email", () => {
    const url = new URL(githubIssueUrl({ id: "r1", app: "pantrino", kind: "bug", message: "Sync fails offline\nThen it hangs", details: "Turn on flight mode, then add an item", page: "/plan", authorEmail: "friend@example.com", state: "open", createdAt: "2026-11-07T10:00:00.000Z" }, "https://tools.example/reports"));
    expect(url.searchParams.get("title")).toBe("[Pantrino] Sync fails offline");
    expect(url.searchParams.get("labels")).toBe("bug");
    expect(url.searchParams.get("body")).toContain("https://tools.example/reports#r1");
    expect(url.searchParams.get("body")).toContain("### How to make it happen again\n\nTurn on flight mode, then add an item");
    expect(url.searchParams.get("body")).not.toContain("friend@example.com");
  });

  it("rejects an unknown kind, an empty message, and a message over 4000 characters", () => {
    expect(() => parseDevFeedback({ kind: "rant", message: "x", page: "/" })).toThrow();
    expect(() => parseDevFeedback({ kind: "bug", message: "   ", page: "/" })).toThrow();
    expect(() => parseDevFeedback({ kind: "bug", message: "x".repeat(4001), page: "/" })).toThrow();
  });
});

describe("report intake for apps", () => {
  const sent: unknown[][] = [];
  const reports = { send: async (...args: unknown[]) => { sent.push(args); } } as unknown as DevFeedbackRepository;
  const member = { subject: "member-sub", email: "friend@example.com" } as PlatformPrincipal;
  const resolve = async (request: Request) => request.headers.get("authorization") === "Bearer good" ? member : undefined;
  const post = (body: unknown, headers: Record<string, string> = {}) => handleReportSubmission(new Request("https://tools.example/api/reports", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.1", ...headers }, body: JSON.stringify(body)
  }), resolve, reports);
  const report = { app: "pantrino", kind: "bug", message: "Sync hangs", page: "/plan", context: "Pantrino 1.2.0 · iOS 26.1", contactEmail: "guest@example.com" };

  beforeEach(() => { sent.length = 0; });

  it("stores an anonymous report with its contact email", async () => {
    expect((await post(report)).status).toBe(201);
    expect(sent).toEqual([[{ app: "pantrino", kind: "bug", message: "Sync hangs", page: "/plan", context: "Pantrino 1.2.0 · iOS 26.1", contactEmail: "guest@example.com" }, undefined]]);
  });

  it("names a signed-in sender and ignores a contact email", async () => {
    expect((await post(report, { authorization: "Bearer good" })).status).toBe(201);
    expect(sent[0]).toEqual([expect.not.objectContaining({ contactEmail: expect.anything() }), { subject: "member-sub", email: "friend@example.com" }]);
  });

  it("rejects a bad token instead of storing the report as anonymous", async () => {
    expect((await post(report, { authorization: "Bearer stale" })).status).toBe(401);
    expect(sent).toEqual([]);
  });

  it("rejects a form post, which a browser page could send cross-site", async () => {
    const response = await handleReportSubmission(new Request("https://tools.example/api/reports", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(report) }), resolve, reports);
    expect(response.status).toBe(415);
  });

  it("rejects an invalid report with a message the app can show", async () => {
    const response = await post({ ...report, message: " " }, { "cf-connecting-ip": "203.0.113.2" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: "Write what happened or what you would like." });
  });

  it("limits anonymous reports per address", async () => {
    const statuses = [];
    for (let attempt = 0; attempt < 6; attempt++) statuses.push((await post(report, { "cf-connecting-ip": "203.0.113.9" })).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });
});
