import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DISPOSABLE_DATABASE_SENTINEL, withVerifiedDisposableDatabase } from "../../platform/database/postgres-push-guard.js";
import { devFeedbackRepository, parseDevFeedback } from "../../platform/dev-feedback/dev-feedback.js";
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
    await feedback.send({ authorSubject: "member-sub", authorEmail: "friend@example.com", kind: "bug", message: "The plan page is blank", page: "/kitchen/plan" });
    await feedback.send({ authorSubject: "admin-subject", authorEmail: "max@example.com", kind: "feature", message: "Export the shopping list", page: "/kitchen/shopping" });

    const [newest, oldest] = await feedback.list();
    expect([newest?.message, oldest?.message]).toEqual(["Export the shopping list", "The plan page is blank"]);
    expect(oldest).toMatchObject({ kind: "bug", page: "/kitchen/plan", authorEmail: "friend@example.com", state: "open" });

    expect(await feedback.setState(oldest!.id, "done")).toBe(true);
    expect((await feedback.list()).find((item) => item.id === oldest!.id)?.state).toBe("done");
    expect(await feedback.setState(randomUUID(), "done")).toBe(false);
    expect(await feedback.setState("not-an-id", "done")).toBe(false);
  });
});

describe("dev feedback input", () => {
  it("keeps a trimmed message and only same-site page paths", () => {
    expect(parseDevFeedback({ kind: "feature", message: "  Dark plan view  ", page: "/kitchen/plan?week=2026-11-02" })).toEqual({ kind: "feature", message: "Dark plan view", page: "/kitchen/plan?week=2026-11-02" });
    expect(parseDevFeedback({ kind: "bug", message: "x", page: "//evil.example" }).page).toBe("/");
    expect(parseDevFeedback({ kind: "bug", message: "x", page: "javascript:alert(1)" }).page).toBe("/");
  });

  it("rejects an unknown kind, an empty message, and a message over 4000 characters", () => {
    expect(() => parseDevFeedback({ kind: "rant", message: "x", page: "/" })).toThrow();
    expect(() => parseDevFeedback({ kind: "bug", message: "   ", page: "/" })).toThrow();
    expect(() => parseDevFeedback({ kind: "bug", message: "x".repeat(4001), page: "/" })).toThrow();
  });
});
