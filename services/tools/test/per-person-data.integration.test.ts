import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { attachPlatformPrincipal, type PlatformPrincipal } from "#security";
import { assignExistingRowsToAdmin } from "../database/assign-existing-owner.js";
import { DISPOSABLE_DATABASE_SENTINEL, withVerifiedDisposableDatabase } from "../database/postgres-push-guard.js";
import { feedbackRepository } from "../feedback/repository.js";
import { createFetchApp } from "../publisher/fetch-app.js";
import { createMetadataBackedUploadStorage } from "../publisher/postgres-storage.js";
import { htmlKey, temporaryFileKey, type UploadBodyStorage } from "../publisher/storage.js";
import { createPostgresUploadLinkRepository } from "../publisher/upload-links.js";
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
    await sql`truncate tools.feedback_forms, tools.feedback_submissions, artifacts.objects, artifacts.operations, artifacts.upload_links, artifacts.upload_sessions cascade`;
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

  it("gives Publisher rows from before the owner column to the admin", async () => {
    await sql!`alter table artifacts.upload_links drop column owner_subject`;
    try {
      await sql!`insert into artifacts.upload_links (id, token_hash, created_at, expires_at)
        values (gen_random_uuid(), 'old-hash', now(), now() + interval '1 day')`;
      await assignExistingRowsToAdmin(sql!, "admin-subject");
      expect(await sql!`select owner_subject from artifacts.upload_links`).toEqual([{ owner_subject: "admin-subject" }]);
    } finally {
      await sql!`delete from artifacts.upload_links where owner_subject is null`;
      await sql!`alter table artifacts.upload_links add column if not exists owner_subject text`;
      await sql!`alter table artifacts.upload_links alter column owner_subject set not null`;
      await sql!`create index if not exists upload_links_owner_history_idx on artifacts.upload_links (owner_subject, created_at desc, id desc)`;
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

describe.skipIf(!sql)("Publisher per person", () => {
  const origin = "https://tools.example.test";
  const admin: PlatformPrincipal = { role: "admin", subject: "admin-subject", email: "admin@example.test" };
  const friend: PlatformPrincipal = { role: "member", subject: "friend-subject", email: "friend@example.test", products: ["publisher"] };

  it("shows and changes only the person's own artifacts and upload links, and keeps public links working", async () => {
    const storage = createMetadataBackedUploadStorage(memoryBodies(), sql!);
    const links = createPostgresUploadLinkRepository(databaseUrl!);
    const app = createFetchApp({ storage, uploadLinks: links, uploadToken: "native-token", adminSubject: admin.subject,
      externalUpload: true, publicBaseUrl: origin });
    const as = (principal: PlatformPrincipal, path: string, init: RequestInit = {}) =>
      app(attachPlatformPrincipal(new Request(origin + path, { ...init, headers: { Origin: origin, ...init.headers } }), principal));
    const json = async <T>(response: Promise<Response>) => (await response).json() as Promise<T>;
    try {
      const plan = await json<{ id: string; url: string }>(app(new Request(origin + "/api/uploads", { method: "POST",
        headers: { Authorization: "Bearer native-token" }, body: form("plan.html", "<h1>Plan</h1>", "text/html") })));
      const link = await json<{ id: string; url: string }>(as(friend, "/api/upload-links?durationMs=86400000", { method: "POST" }));
      const guest = await app(new Request(`${link.url.replace("/drop/", "/api/drop/")}/uploads`, { method: "POST",
        headers: { Origin: origin }, body: form("from-guest.txt", "hello", "text/plain") }));
      expect(guest.status).toBe(201);
      const received = await guest.json() as { id: string; url: string };
      expect(await sql!`select id, owner_subject from artifacts.objects order by owner_subject`).toEqual([
        { id: plan.id, owner_subject: admin.subject },
        { id: received.id, owner_subject: friend.subject }
      ]);

      const inventory = async (principal: PlatformPrincipal) =>
        (await json<{ uploads: { id: string }[] }>(as(principal, "/api/external-uploads"))).uploads.map((upload) => upload.id);
      expect(await inventory(admin)).toEqual([plan.id]);
      expect(await inventory(friend)).toEqual([received.id]);
      const linkIds = async (principal: PlatformPrincipal) =>
        (await json<{ links: { id: string }[] }>(as(principal, "/api/upload-links"))).links.map((item) => item.id);
      expect(await linkIds(friend)).toEqual([link.id]);
      expect(await linkIds(admin)).toEqual([]);

      const editPlan = { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: "taken" }) };
      expect((await as(friend, `/api/external-uploads/${plan.id}`, editPlan)).status).toBe(404);
      expect((await as(friend, `/api/external-uploads/${plan.id}`, { method: "DELETE" })).status).toBe(204);
      expect((await as(admin, `/api/upload-links/${link.id}/download`)).status).toBe(404);
      expect((await as(admin, `/api/upload-links/${link.id}`, { method: "DELETE" })).status).toBe(404);
      expect((await as(admin, `/api/external-uploads/${received.id}`, { method: "DELETE" })).status).toBe(204);
      expect(await sql!`select id from artifacts.objects where revoked_at is null order by owner_subject`).toEqual([{ id: plan.id }, { id: received.id }]);

      const page = await app(new Request(plan.url));
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("<h1>Plan</h1>");
      expect((await app(new Request(received.url))).status).toBe(200);
      expect((await app(new Request(link.url))).status).toBe(200);

      expect((await as(admin, `/api/external-uploads/${plan.id}`, editPlan)).status).toBe(200);
      expect((await as(friend, `/api/upload-links/${link.id}`, { method: "DELETE" })).status).toBe(204);
      expect((await as(friend, `/api/upload-links/${link.id}/download`)).status).toBe(200);
      expect((await as(friend, `/api/external-uploads/${received.id}`, { method: "DELETE" })).status).toBe(204);
      expect(await inventory(friend)).toEqual([]);
      expect((await app(new Request(received.url))).status).toBe(404);
    } finally {
      await links.close?.();
    }
  });
});

function form(filename: string, content: string, type: string) {
  const body = new FormData();
  body.set("file", new File([content], filename, { type }));
  return body;
}

function memoryBodies(): UploadBodyStorage {
  const objects = new Map<string, Buffer>();
  const read = (key: string, headOnly?: boolean) => {
    const body = objects.get(key);
    return body ? { body: Readable.from(headOnly ? [] : [body]), bytes: body.length } : null;
  };
  return {
    async putHtml(id, filePath, _metadata, options) { objects.set(options?.objectKey ?? htmlKey(id), await readFile(filePath)); },
    async getHtml(id, options) {
      const stored = read(options?.objectKey ?? htmlKey(id), options?.headOnly);
      return stored ? { ...stored, etag: `"${stored.bytes}"` } : null;
    },
    async putTemporaryFile(id, filePath, _metadata, options) { objects.set(options?.objectKey ?? temporaryFileKey(id), await readFile(filePath)); },
    async getTemporaryFile(id, options) {
      const stored = read(options?.objectKey ?? temporaryFileKey(id), options?.headOnly);
      return stored ? { ...stored, contentType: "application/octet-stream", originalName: id } : null;
    },
    async updateFileExpiry(id, _expiresAt, options) { return objects.has(options?.objectKey ?? temporaryFileKey(id)); },
    async deleteUpload(id, options) {
      for (const key of options?.objectKey ? [options.objectKey] : [htmlKey(id), temporaryFileKey(id)]) objects.delete(key);
    }
  };
}
