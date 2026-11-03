import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { attachPlatformPrincipal, type PlatformPrincipal } from "#security";
import { assignExistingRowsToAdmin } from "../../../platform/database/assign-existing-owner.js";
import { DISPOSABLE_DATABASE_SENTINEL, withVerifiedDisposableDatabase } from "../../../platform/database/postgres-push-guard.js";
import { feedbackRepository } from "../../../products/feedback/repository.js";
import { parseMoneyImport } from "../../../products/money/money-import-domain.js";
import { postgresMoneyRepository, type MoneyOwnerRepository } from "../../../products/money/money-repository.js";
import { createDocumentChanges } from "../../../products/documents/changes.js";
import { createShareHandler } from "../../../products/documents/http.js";
import { createMarkdownShareRepository } from "../../../products/documents/repository.js";
import { applyMarkdownShareSchema } from "../../../products/documents/schema.js";
import type { PublicDocument } from "../../../products/documents/types.js";
import { createFetchApp } from "../../../products/publisher/fetch-app.js";
import { createMetadataBackedUploadStorage } from "../../../products/publisher/postgres-storage.js";
import { htmlKey, temporaryFileKey, type UploadBodyStorage } from "../../../products/publisher/storage.js";
import { createPostgresUploadLinkRepository } from "../../../products/publisher/upload-links.js";
import { requireLoopbackPostgres } from "../../harness/postgres.ts";

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
    await sql`truncate tools.feedback_forms, tools.feedback_submissions, artifacts.objects, artifacts.operations, artifacts.upload_links, artifacts.upload_sessions, tools.markdown_documents, tools.money_balance_snapshots, tools.money_category_rules, tools.money_transfer_rules, tools.money_transfer_pair_rules, tools.money_investment_events, tools.money_transactions, tools.money_imports, tools.money_accounts cascade`;
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

describe.skipIf(!sql)("Money per person", () => {
  const statement = (...rows: string[]) => Buffer.from(["Type\tProduct\tStarted Date\tCompleted Date\tDescription\tAmount\tFee\tCurrency\tState\tBalance", ...rows].join("\r\n"));
  const bakery = "Card Payment\tCurrent\t2026-09-05 12:00:00\t2026-09-05 12:00:00\tBakery\t-4\t0\tEUR\tCOMPLETED\t96";
  const toSavings = "Transfer\tCurrent\t2026-09-10 12:00:00\t2026-09-10 12:00:00\tTo savings\t-20\t0\tEUR\tCOMPLETED\t76";
  const intoSavings = "Transfer\tSavings\t2026-09-10 12:00:00\t2026-09-10 12:00:00\tTo savings\t20\t0\tEUR\tCOMPLETED\t20";
  const commit = (ledger: MoneyOwnerRepository, source: Buffer) => {
    const parsed = parseMoneyImport(source);
    return ledger.commitImport({ digest: parsed.digest, format: parsed.format, filename: "statement.tsv", bytes: source.byteLength, rowCount: parsed.rowCount,
      actor: "person@example.test", transactions: parsed.transactions, investmentEvents: parsed.investmentEvents, balanceSnapshots: parsed.balanceSnapshots, warnings: parsed.warnings });
  };
  const items = async (ledger: MoneyOwnerRepository) => (await ledger.readActivityPage({ query: "", offset: 0, limit: 50 })).items;

  it("keeps imports, transfers, rules, and changes inside each person's own ledger", async () => {
    const money = postgresMoneyRepository(sql!);
    const max = money.owner("admin-subject");
    const friend = money.owner("friend-subject");
    const control = money.owner("control-subject");

    const maxImport = await commit(max, statement(bakery, toSavings));
    const friendImport = await commit(friend, statement(bakery, toSavings));
    expect(friendImport).toMatchObject({ replay: false, insertedCount: 2 });
    expect(friendImport.id).not.toBe(maxImport.id);
    await commit(friend, statement(intoSavings));
    await commit(control, statement(toSavings, intoSavings));

    expect((await max.readLedgerSnapshot("all")).transferReview.linkedPairs).toBe(0);
    expect((await friend.readLedgerSnapshot("all")).transferReview.linkedPairs).toBe(1);
    expect((await control.readLedgerSnapshot("all")).transferReview.linkedPairs).toBe(1);

    const maxRows = await items(max);
    const maxBakery = maxRows.find((item) => item.description === "Bakery")!;
    const maxTransfer = maxRows.find((item) => item.description === "To savings")!;
    expect(maxRows).toHaveLength(2);
    expect((await items(friend)).map((item) => item.id)).not.toContain(maxBakery.id);

    const { ruleId } = await max.saveCategoryRule({ matchField: "description", matchOperator: "equals", matchValue: "bakery", category: "groceries", actor: "max@example.test", expectedMatchCount: 1 });
    expect((await items(max)).find((item) => item.id === maxBakery.id)?.category).toBe("groceries");
    expect((await items(friend)).find((item) => item.description === "Bakery")?.category).toBe("uncategorized");
    expect((await friend.readLedgerSnapshot("all")).categoryRules).toEqual([]);

    await expect(friend.setTransactionCategory({ transactionId: maxBakery.id, category: "dining", actor: "friend@example.test", createRule: false })).rejects.toThrow(/not found/);
    await expect(friend.setTransferDisposition({ transactionId: maxTransfer.id, disposition: "spend" })).rejects.toThrow(/not found/);
    expect(await friend.setTransferDispositions({ transactionIds: [maxTransfer.id], disposition: "spend" })).toEqual({ affectedCount: 0 });
    await expect(friend.addManualBalance({ accountId: maxBakery.accountId!, date: "2026-09-30", valueMinor: 1, currency: "EUR" })).rejects.toThrow(/not found/);
    await expect(friend.saveCategoryRule({ ruleId, matchField: "description", matchOperator: "equals", matchValue: "bakery", category: "dining", actor: "friend@example.test", expectedMatchCount: 1 })).rejects.toMatchObject({ code: "rule_not_found" });
    await expect(friend.saveCategoryRule({ accountId: maxBakery.accountId!, matchField: "description", matchOperator: "equals", matchValue: "bakery", category: "dining", actor: "friend@example.test", expectedMatchCount: 0 })).rejects.toMatchObject({ code: "account_not_found" });
    expect(await friend.deleteCategoryRule(ruleId)).toBeUndefined();
    expect(await friend.deleteImport(maxImport.id)).toBeUndefined();

    const after = await items(max);
    expect(after.find((item) => item.id === maxBakery.id)).toMatchObject({ category: "groceries", categoryOrigin: "rule" });
    expect(after.find((item) => item.id === maxTransfer.id)?.transferDisposition).toBeUndefined();
    expect((await max.readLedgerSnapshot("all")).imports.map((item) => item.id)).toEqual([maxImport.id]);
  });
});

describe.skipIf(!sql)("Document Share per person", () => {
  const origin = "https://tools.example.test";
  const sessions: Record<string, string> = { "session=max": "admin-subject", "session=friend": "friend-subject" };

  it("lists only the person's own documents, keeps capability links open without a session, and expires every owner's documents", async () => {
    const repository = createMarkdownShareRepository(databaseUrl!);
    const changes = createDocumentChanges(databaseUrl!);
    const share = createShareHandler(repository, changes, origin,
      async (request) => sessions[request.headers.get("cookie") ?? ""] ?? "admin-subject");
    const call = (path: string, body?: unknown, cookie?: string) => share(new Request(`${origin}/api/share/documents${path}`, body === undefined ? {} : {
      method: "POST", body: JSON.stringify(body),
      headers: { Origin: origin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }
    }));
    const create = async (filename: string, cookie?: string) =>
      (await (await call("", { requestId: randomBytes(16).toString("hex"), filename, format: "markdown", markdown: filename }, cookie)).json()) as PublicDocument;
    const tokens = async (subject: string) => (await repository.owner(subject).list()).documents.map((document) => document.token).sort();
    try {
      const mine = await create("max.md", "session=max");
      const anonymous = await create("anonymous.md");
      const friends = await create("friend.md", "session=friend");

      expect(await tokens("admin-subject")).toEqual([mine.token, anonymous.token].sort());
      expect(await tokens("friend-subject")).toEqual([friends.token]);
      expect(await tokens("someone-else")).toEqual([]);

      const request = { requestId: "shared-request", filename: "notes.md", format: "markdown", markdown: "" };
      const original = (await (await call("", request, "session=max")).json()) as PublicDocument;
      const replayed = (await (await call("", request, "session=friend")).json()) as PublicDocument;
      expect(replayed.token, "a replayed creation request never returns another person's document").not.toBe(original.token);
      expect((await (await call("", request, "session=max")).json()) as PublicDocument).toMatchObject({ token: original.token });
      expect(await tokens("friend-subject")).toEqual([friends.token, replayed.token].sort());
      await sql!`delete from tools.markdown_documents where request_id = 'shared-request'`;

      const opened = await call(`/${friends.token}`);
      expect(opened.status, "a capability link needs no session").toBe(200);
      expect(await opened.json()).toMatchObject({ document: { token: friends.token, filename: "friend.md" }, version: 0 });
      expect((await call(`/${friends.token}/pin`, { pinned: true })).status, "anyone with the link can pin").toBe(200);
      expect((await call(`/${mine.token}/checkpoints`, { createdBy: "Guest" })).status, "anyone with the link can save a checkpoint").toBe(200);
      expect((await repository.owner("friend-subject").list()).documents).toMatchObject([{ token: friends.token, pinned: true }]);
      expect((await repository.owner("admin-subject").list()).documents.find((document) => document.token === mine.token)?.checkpointCount).toBe(1);

      await sql!`update tools.markdown_documents set expires_at = ${Date.now() - 1} where token in ${sql!([mine.token, friends.token])}`;
      expect(await repository.expire(1000)).toBe(2);
      expect(await tokens("admin-subject")).toEqual([anonymous.token]);
      expect(await tokens("friend-subject")).toEqual([]);
    } finally {
      await changes.close();
      await repository.close();
    }
  });

  it("gives documents from before the owner column to the admin, once", async () => {
    await applyMarkdownShareSchema(sql!, "admin-subject");
    await sql!`alter table tools.markdown_documents drop column owner_subject`;
    try {
      await sql!`insert into tools.markdown_documents (token, request_id, request_hash, filename, format, created_at, updated_at, expires_at, content, source)
        values ('old-document-token-0000000000', 'old-request', 'hash', 'old.md', 'markdown', 0, 0, ${Date.now() + 86_400_000}, '{}', 'old')`;
      await expect(applyMarkdownShareSchema(sql!, undefined)).rejects.toThrow(/AUTH_ALLOWED_GOOGLE_SUBJECT/);
      await applyMarkdownShareSchema(sql!, "admin-subject");
      await applyMarkdownShareSchema(sql!, "someone-else");
      expect(await sql!`select token, owner_subject from tools.markdown_documents`).toEqual([{ token: "old-document-token-0000000000", owner_subject: "admin-subject" }]);
      expect(await sql!`select is_nullable from information_schema.columns
        where table_schema = 'tools' and table_name = 'markdown_documents' and column_name = 'owner_subject'`).toEqual([{ is_nullable: "NO" }]);
    } finally {
      await sql!`alter table tools.markdown_documents add column if not exists owner_subject text`;
      await sql!`delete from tools.markdown_documents where owner_subject is null`;
      await applyMarkdownShareSchema(sql!, "admin-subject");
    }
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
