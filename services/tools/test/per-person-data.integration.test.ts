import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { assignExistingRowsToAdmin } from "../database/assign-existing-owner.js";
import { DISPOSABLE_DATABASE_SENTINEL, withVerifiedDisposableDatabase } from "../database/postgres-push-guard.js";
import { feedbackRepository } from "../feedback/repository.js";
import { requireLoopbackPostgres } from "./runtime/postgres.ts";

const databaseUrl = process.env.TEST_DATABASE_URL ? requireLoopbackPostgres(process.env.TEST_DATABASE_URL) : undefined;
const confirmed = process.env.MONEY_TEST_DATABASE_CONFIRM === "money-repository-test";
const sql = databaseUrl && confirmed ? postgres(databaseUrl, { max: 2 }) : undefined;

beforeEach(async () => {
  if (!sql) return;
  await withVerifiedDisposableDatabase({
    readRelationKind: async () => (await sql<{ kind: string }[]>`
      select c.relkind::text kind from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = ${DISPOSABLE_DATABASE_SENTINEL.relation}`)[0]?.kind,
    readValue: async () => (await sql<{ value: string }[]>`
      select sentinel_value value from public.tools_runtime_test_sentinel
      where sentinel_key = ${DISPOSABLE_DATABASE_SENTINEL.key}`)[0]?.value,
  }, async () => {
    await sql`truncate tools.feedback_forms, tools.feedback_submissions cascade`;
  });
});

afterAll(async () => { await sql?.end(); });

describe.skipIf(!sql)("existing rows before per-person data", () => {
  it("gives rows from before the owner column to the admin, once", async () => {
    await sql!`alter table tools.feedback_forms drop column owner_subject`;
    try {
      await sql!`insert into tools.feedback_forms (id, public_token, title, introduction, questions, status, created_at, updated_at)
        values (gen_random_uuid(), 'old-token', 'Old form', '', '[]', 'draft', now(), now())`;
      await expect(assignExistingRowsToAdmin(sql!, undefined)).rejects.toThrow(/AUTH_ALLOWED_GOOGLE_SUBJECT/);
      await assignExistingRowsToAdmin(sql!, "admin-subject");
      await assignExistingRowsToAdmin(sql!, "someone-else");
      expect(await sql!`select owner_subject from tools.feedback_forms`).toEqual([{ owner_subject: "admin-subject" }]);
    } finally {
      await sql!`delete from tools.feedback_forms where owner_subject is null`;
      await sql!`alter table tools.feedback_forms add column if not exists owner_subject text`;
      await sql!`alter table tools.feedback_forms alter column owner_subject set not null`;
      await sql!`create index if not exists feedback_forms_owner_updated_idx on tools.feedback_forms (owner_subject, updated_at)`;
    }
  });
});

describe.skipIf(!sql)("Feedback per person", () => {
  it("shows and changes only the person's own forms and responses, and keeps public links working", async () => {
    const feedback = feedbackRepository(sql!, randomBytes(32));
    const max = feedback.owner("admin-subject");
    const friend = feedback.owner("friend-subject");
    const form = await max.createForm({ language: "en" });
    await max.setFormStatus(form.id, "active");
    const submission = await feedback.createSubmission((await feedback.getPublicForm(form.publicToken))!, { identity: "Guest" });

    expect((await max.listForms()).map((item) => item.id)).toEqual([form.id]);
    expect(await friend.listForms()).toEqual([]);
    expect(await friend.getForm(form.id)).toBeUndefined();
    expect(await friend.listSubmissions(form.id)).toEqual([]);
    expect(await friend.listRecentSubmissions(10)).toEqual([]);
    expect(await friend.getSubmission(submission.id)).toBeUndefined();

    expect(await friend.updateForm(form.id, { language: "en", title: "Taken", introduction: "", questions: [] })).toBeUndefined();
    expect(await friend.setFormStatus(form.id, "closed")).toBeUndefined();
    expect(await friend.rotateToken(form.id)).toBeUndefined();
    expect(await friend.updateSubmission(submission.id, { reviewState: "archived", followUpState: "done" })).toBeUndefined();
    expect(await friend.deleteSubmission(submission.id)).toBe(false);
    expect(await friend.deleteForm(form.id)).toBe(false);

    const unchanged = (await max.getForm(form.id))!;
    expect(unchanged).toMatchObject({ title: "", status: "active", publicToken: form.publicToken, responseCount: 1, unreadCount: 1 });
    expect((await max.getSubmission(submission.id))?.reviewState).toBe("unread");

    const own = await friend.createForm({ language: "de" });
    expect((await friend.listForms()).map((item) => item.id)).toEqual([own.id]);
    expect((await max.listForms()).map((item) => item.id)).toEqual([form.id]);
  });
});
