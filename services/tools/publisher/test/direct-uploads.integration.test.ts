import crypto from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GetObjectCommand, HeadObjectCommand, ListMultipartUploadsCommand, PutBucketCorsCommand, PutObjectCommand, S3Client, UploadPartCommand } from "@aws-sdk/client-s3";
import { createFetchApp } from "../src/fetch-app.js";
import { createDirectUploads, DIRECT_PART_BYTES } from "../src/direct-uploads.js";
import { createMultipartStorage } from "../src/multipart-storage.js";
import { createMetadataBackedUploadStorage } from "../src/postgres-storage.js";
import { createS3UploadStorage, type UploadStorage } from "../src/storage.js";
import { createPostgresUploadLinkRepository } from "../src/upload-links.js";

const databaseUrl = process.env.PUBLISHER_TRANSFER_TEST_DATABASE_URL;
const endpoint = process.env.PUBLISHER_TRANSFER_TEST_S3_ENDPOINT;
const enabled = Boolean(databaseUrl && endpoint);
const origin = "http://127.0.0.1:43171";
const config = { bucket: "tools-transfer-test", endpoint: endpoint ?? "http://127.0.0.1:49000",
  region: "us-east-1", accessKeyId: "transfer-local", secretAccessKey: "transfer-local-secret", forcePathStyle: true };
const digest = (bytes: Uint8Array) => crypto.createHash("sha256").update(bytes).digest("hex");

describe.skipIf(!enabled)("isolated Postgres and S3 direct transfers", () => {
  let sql: Sql;
  let storage: UploadStorage;
  let bodies: UploadStorage;
  let bucket: ReturnType<typeof createMultipartStorage>;
  let links: ReturnType<typeof createPostgresUploadLinkRepository>;
  let client: S3Client;
  let app: ReturnType<typeof createFetchApp>;
  const sessions: Array<{ id: string; base: string }> = [];
  let applicationUploadBytes = 0;
  let bucketUploadBytes = 0;

  function attach() {
    bodies = createS3UploadStorage(config);
    storage = createMetadataBackedUploadStorage(bodies, sql);
    bucket = createMultipartStorage(config);
    storage.directUploads = createDirectUploads(sql, bucket, postgres(databaseUrl!, { max: 2, idle_timeout: 1 }));
    storage.uploadOrigins = [config.endpoint];
    app = createFetchApp({ storage, uploadLinks: links, uploadToken: "transfer-local-token", publicBaseUrl: origin,
      externalUpload: true, browserPersistentUpload: true, maxConcurrentUploads: 1 });
  }

  beforeAll(async () => {
    if (new URL(databaseUrl!).hostname !== "127.0.0.1" || new URL(endpoint!).hostname !== "127.0.0.1") throw new Error("Transfer fixtures must be on owned loopback resources");
    sql = postgres(databaseUrl!, { max: 3, idle_timeout: 1 });
    // Match the guarded schema-push sentinel before using this owned database.
    const [sentinel] = await sql<{ kind: string; value: string }[]>`
      select c.relkind::text kind, s.sentinel_value value from pg_class c
      join pg_namespace n on n.oid=c.relnamespace cross join tools_runtime_test_sentinel s
      where n.nspname='public' and c.relname='tools_runtime_test_sentinel'
        and s.sentinel_key='database-purpose'`;
    if (sentinel?.kind !== "r" || sentinel.value !== "tools-runtime-disposable-test-database") {
      throw new Error("Transfer tests require the disposable database sentinel");
    }
    links = createPostgresUploadLinkRepository(databaseUrl!);
    client = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, requestChecksumCalculation: "WHEN_REQUIRED" });
    await client.send(new PutBucketCorsCommand({ Bucket: config.bucket, CORSConfiguration: { CORSRules: [
      { AllowedOrigins: [origin], AllowedMethods: ["GET", "HEAD", "PUT"], AllowedHeaders: ["*"], ExposeHeaders: ["Content-Range", "Content-Length", "ETag"], MaxAgeSeconds: 300 },
      { AllowedOrigins: ["*"], AllowedMethods: ["GET", "HEAD"], AllowedHeaders: ["*"], ExposeHeaders: ["Content-Range", "Content-Length", "ETag"] }
    ] } }));
    attach();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    for (const session of sessions) {
      await request(session.base + "/" + session.id, "DELETE");
      const [row] = await sql<{ artifact_id: string }[]>`select artifact_id from artifacts.upload_sessions where session_id = ${session.id}::uuid`;
      if (row) await storage.deleteUpload(row.artifact_id);
    }
    await storage.close?.();
    await links.close?.();
    client.destroy();
  });

  async function request(path: string, method = "POST", value?: unknown) {
    const body = value === undefined ? undefined : JSON.stringify(value);
    applicationUploadBytes += Buffer.byteLength(body ?? "");
    return app(new Request(origin + path, { method, headers: {
      Authorization: "Bearer transfer-local-token", Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body } : {}) }));
  }

  async function initialize(bytes: number, options: { base?: string; requestId?: string; filename?: string; kind?: "html" | "file"; contentType?: string; project?: string; replaceId?: string } = {}) {
    const base = options.base ?? "/api/uploads/sessions";
    const id = options.requestId ?? crypto.randomUUID();
    const response = await request(base, "POST", { requestId: id, filename: options.filename ?? "fixture.bin",
      contentType: options.contentType ?? "application/octet-stream", totalBytes: bytes, kind: options.kind ?? "file",
      ...(options.project ? { project: options.project } : {}), ...(options.replaceId ? { replaceId: options.replaceId } : {}) });
    if (response.status !== 201) console.info("initialization failure", await response.clone().json());
    expect(response.status).toBe(201);
    const session = await response.json() as { sessionId: string; partBytes: number; totalParts: number };
    sessions.push({ id, base });
    return { ...session, path: base + "/" + session.sessionId };
  }

  async function put(session: { path: string }, number: number, bytes: Buffer, expectedDigest = digest(bytes)) {
    const response = await request(session.path + "/parts", "POST", { number, sha256: expectedDigest });
    expect(response.status).toBe(200);
    const { url } = await response.json() as { url: string };
    expect(new URL(url).origin).toBe(config.endpoint);
    expect(new URL(url).searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
    const uploaded = await fetch(url, { method: "PUT", body: new Uint8Array(bytes) });
    expect(uploaded.status).toBe(200);
    bucketUploadBytes += bytes.length;
    return url;
  }

  async function html(body: string, replaceId?: string, project?: string) {
    const bytes = Buffer.from(body);
    const session = await initialize(bytes.length, { kind: "html", filename: "plan.html", contentType: "text/html", replaceId, project });
    await put(session, 1, bytes);
    return session;
  }

  async function raw(key: string) {
    const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
    return result.Body!.transformToString();
  }

  async function legacyReplace(id: string, body: string, base = "/api/uploads", project?: string) {
    const form = new FormData();
    form.append("file", new Blob([body], { type: "text/html" }), "legacy.html");
    if (project) form.append("project", project);
    return app(new Request(`${origin}${base}/${id}`, { method: "PUT",
      headers: { Authorization: "Bearer transfer-local-token", Origin: origin }, body: form }));
  }

  it.each(["/api/uploads", "/api/external-uploads"])("preserves a project edited during legacy verification through %s", async base => {
    const created = await html("before legacy verification", undefined, "original-project");
    const { id } = await (await request(created.path + "/complete")).json() as { id: string };
    const get = bodies.getHtml.bind(bodies);
    const entered = deferred();
    const release = deferred();
    const verify = vi.spyOn(bodies, "getHtml").mockImplementation(async (artifactId, options) => {
      const stored = await get(artifactId, options);
      if (artifactId === id && !options?.headOnly && options?.objectKey?.startsWith(`transfers/${id}/`)) {
        entered.resolve();
        await release.promise;
      }
      return stored;
    });
    const pending = legacyReplace(id, "after legacy verification", base);
    try {
      await entered.promise;
      expect(await storage.updateHtmlProject(id, "edited-during-verification")).toBe(true);
    } finally { release.resolve(); }
    try {
      const response = await pending;
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id, project: "edited-during-verification" });
      const stored = await storage.getHtml(id, { headOnly: true });
      stored?.body.destroy();
      expect(stored?.project).toBe("edited-during-verification");
      expect(stored?.sha256).toBe(digest(Buffer.from("after legacy verification")));
      const explicit = await legacyReplace(id, "explicit project replacement", base, "explicit-project");
      expect(explicit.status).toBe(200);
      expect(await explicit.json()).toMatchObject({ id, project: "explicit-project" });
      const [current] = await sql`select project from artifacts.objects where id = ${id}`;
      expect(current?.project).toBe("explicit-project");
    } finally {
      verify.mockRestore();
      await storage.deleteUpload(id);
    }
  });

  it("recovers a new-format legacy journal without undoing a later project edit", async () => {
    const created = await html("before journal recovery", undefined, "original-project");
    const { id } = await (await request(created.path + "/complete")).json() as { id: string };
    const [before] = await sql`select object_key from artifacts.objects where id = ${id}`;
    const get = bodies.getHtml.bind(bodies);
    const interrupted = vi.spyOn(bodies, "getHtml").mockImplementation(async (artifactId, options) => {
      if (artifactId === id && !options?.headOnly) throw new Error("Interrupted legacy verification");
      return get(artifactId, options);
    });
    try {
      expect((await legacyReplace(id, "recovered legacy replacement")).status).toBe(500);
    } finally { interrupted.mockRestore(); }
    try {
      const [operation] = await sql<{ operation_id: string; payload: { objectKey: string; expectedObjectKey: string } }[]>`
        select operation_id, payload from artifacts.operations where artifact_id = ${id}`;
      expect(operation?.payload.expectedObjectKey).toBe(before!.object_key);
      expect(await raw(operation!.payload.objectKey)).toBe("recovered legacy replacement");
      expect(await storage.updateHtmlProject(id, "edited-after-interruption")).toBe(true);
      await sql`update artifacts.operations set lease_until = now() - interval '1 second'
        where operation_id = ${operation!.operation_id}::uuid`;
      const recovered = await storage.getHtml(id, { headOnly: true });
      recovered?.body.destroy();
      expect(recovered?.project).toBe("edited-after-interruption");
      expect(recovered?.sha256).toBe(digest(Buffer.from("recovered legacy replacement")));
      const [receipt] = await sql`select receipt from artifacts.upload_sessions where session_id = ${operation!.operation_id}::uuid`;
      expect(receipt?.receipt.after.project).toBe("edited-after-interruption");
      expect(await sql`select operation_id from artifacts.operations where artifact_id = ${id}`).toHaveLength(0);
      expect(await raw(before!.object_key)).toBe("before journal recovery");
    } finally {
      await sql`delete from artifacts.operations where artifact_id = ${id}`;
      await storage.deleteUpload(id);
    }
  });

  it.each([
    { interrupted: false, revoked: false },
    { interrupted: true, revoked: false },
    { interrupted: true, revoked: true }
  ])("retains stale legacy staging ownership and continues recovery with %j", async ({ interrupted, revoked }) => {
    const created = await html("retained original", undefined, "original-project");
    const { id } = await (await request(created.path + "/complete")).json() as { id: string };
    const healthy = await html("unrelated healthy page");
    const other = await (await request(healthy.path + "/complete")).json() as { id: string; url: string };
    const [before] = await sql`select * from artifacts.objects where id = ${id}`;
    const winner = await html("canonical winner", id);
    const get = bodies.getHtml.bind(bodies);
    let reads = 0;
    let stagedKey: string | undefined;
    const race = vi.spyOn(bodies, "getHtml").mockImplementation(async (artifactId, options) => {
      if (artifactId === id && !options?.headOnly && options?.objectKey?.startsWith(`transfers/${id}/`)) {
        stagedKey = options.objectKey;
        if (interrupted) throw new Error("Interrupted stale legacy verification");
      }
      const stored = await get(artifactId, options);
      if (artifactId === id && options?.headOnly && ++reads === 2) {
        expect((await request(winner.path + "/complete")).status).toBe(201);
        if (revoked) await sql`update artifacts.objects set revoked_at = now() where id = ${id}`;
      }
      return stored;
    });
    const nextOperation = crypto.randomUUID();
    const nextArtifact = crypto.randomBytes(24).toString("base64url");
    try {
      try {
        const response = await legacyReplace(id, "unpublished stale bytes");
        expect(response.status).toBe(interrupted ? 500 : 409);
        if (!interrupted) expect(await response.json()).toMatchObject({ error: "upload_conflict" });
      } finally { race.mockRestore(); }
      expect(stagedKey).toBeDefined();
      const stagingId = stagedKey!.split("/").at(-1)!;
      const [current] = await sql`select * from artifacts.objects where id = ${id}`;
      expect(current!.object_key).not.toBe(before!.object_key);
      expect(current!.project).toBe("original-project");
      expect(current!.created_at).toEqual(before!.created_at);
      expect(await raw(before!.object_key)).toBe("retained original");
      expect(await raw(current!.object_key)).toBe("canonical winner");
      expect(await raw(stagedKey!)).toBe("unpublished stale bytes");
      const [operation] = await sql`select operation_id from artifacts.operations where artifact_id = ${id}`;
      expect(Boolean(operation)).toBe(interrupted);
      await sql`update artifacts.operations set lease_until = now() - interval '1 second', created_at = now() - interval '2 minutes'
        where artifact_id = ${id}`;
      await sql`insert into artifacts.operations (operation_id, artifact_id, owner_id, lease_until, operation_kind, created_at)
        values (${nextOperation}::uuid, ${nextArtifact}, 'following-stale-fixture', now() - interval '1 second', 'delete', now() - interval '1 minute')`;
      const response = await app(new Request(other.url));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("unrelated healthy page");
      expect(await sql`select operation_id from artifacts.operations where artifact_id = ${id} or operation_id = ${nextOperation}::uuid`).toHaveLength(0);
      const [retained] = await sql`select * from artifacts.upload_sessions where artifact_id = ${stagingId}`;
      expect(retained).toMatchObject({ target_id: id, expected_object_key: before!.object_key,
        state: "failed", sha256: digest(Buffer.from("unpublished stale bytes")), cleaned_at: null, receipt: null,
        description: { kind: "html", filename: "legacy.html", totalBytes: Buffer.byteLength("unpublished stale bytes") } });
      if (operation) expect(retained!.session_id).toBe(operation.operation_id);
      expect(await sql`select * from artifacts.objects where id = ${id}`).toEqual([current]);
      const remove = bucket.remove.bind(bucket);
      const blocked = vi.spyOn(bucket, "remove").mockImplementation(async (key, signal) => {
        if (key === stagedKey) throw new Error("Staged cleanup interrupted");
        return remove(key, signal);
      });
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try { await storage.directUploads!.cleanup(); }
      finally { blocked.mockRestore(); log.mockRestore(); }
      expect(await raw(stagedKey!)).toBe("unpublished stale bytes");
      const [pending] = await sql`select * from artifacts.upload_sessions where session_id = ${retained!.session_id}::uuid`;
      expect(pending).toMatchObject({ artifact_id: stagingId, target_id: id, state: "aborted", cleaned_at: null });
      await storage.close?.();
      sql = postgres(databaseUrl!, { max: 3, idle_timeout: 1 });
      attach();
      const restarted = await app(new Request(other.url));
      expect(restarted.status).toBe(200);
      expect(await restarted.text()).toContain("unrelated healthy page");
      await storage.directUploads!.cleanup();
      await expect(raw(stagedKey!)).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
      expect(await raw(before!.object_key)).toBe("retained original");
      expect(await raw(current!.object_key)).toBe("canonical winner");
      expect(await sql`select * from artifacts.objects where id = ${id}`).toEqual([current]);
      const [cleaned] = await sql`select cleaned_at from artifacts.upload_sessions where session_id = ${retained!.session_id}::uuid`;
      expect(cleaned?.cleaned_at).toBeInstanceOf(Date);
      await sql`update artifacts.upload_sessions set expires_at = now() - interval '3 days' where session_id = ${retained!.session_id}::uuid`;
      await storage.directUploads!.cleanup();
      expect((await request("/api/uploads/sessions", "POST", { requestId: retained!.session_id, kind: "html",
        filename: "plan.html", contentType: "text/html", totalBytes: 5, replaceId: id })).status).toBe(404);
      const [reserved] = await sql`select artifact_id, target_id from artifacts.upload_sessions where session_id = ${retained!.session_id}::uuid`;
      expect(reserved).toEqual({ artifact_id: stagingId, target_id: id });
    } finally {
      race.mockRestore();
      await sql`delete from artifacts.operations where artifact_id = ${id} or operation_id = ${nextOperation}::uuid`;
      await storage.deleteUpload(id);
      await storage.deleteUpload(other.id);
    }
  });

  it("cleans pending uploads before more than twenty cleaned replacements and retries late bodies", async () => {
    const created = await html("cleanup target");
    const { id } = await (await request(created.path + "/complete")).json() as { id: string };
    const pending = await html("pending cleanup", id);
    const cleaned = Array.from({ length: 21 }, () => ({ sessionId: crypto.randomUUID(), artifactId: crypto.randomBytes(24).toString("base64url") }));
    try {
      const [target] = await sql`select object_key from artifacts.objects where id = ${id}`;
      for (const row of cleaned) {
        await sql`insert into artifacts.upload_sessions
          (session_id, artifact_id, target_id, expected_object_key, audience, description, state, expires_at, cleaned_at)
          values (${row.sessionId}::uuid, ${row.artifactId}, ${id}, ${target!.object_key}, 'native',
            ${sql.json({ kind: "html", filename: "plan.html", contentType: "text/html", totalBytes: 4, partBytes: DIRECT_PART_BYTES })},
            'aborted', now() - interval '1 hour', now())`;
      }
      await sql`update artifacts.upload_sessions set expires_at = now() - interval '1 second' where session_id = ${pending.sessionId}::uuid`;
      const [row] = await sql`select artifact_id from artifacts.upload_sessions where session_id = ${pending.sessionId}::uuid`;
      const pendingKey = `transfers/${id}/${row!.artifact_id}`;
      expect((await client.send(new ListMultipartUploadsCommand({ Bucket: config.bucket, Prefix: pendingKey }))).Uploads).toHaveLength(1);
      await storage.directUploads!.cleanup();
      expect((await client.send(new ListMultipartUploadsCommand({ Bucket: config.bucket, Prefix: pendingKey }))).Uploads ?? []).toHaveLength(0);
      const [finished] = await sql`select cleaned_at from artifacts.upload_sessions where session_id = ${pending.sessionId}::uuid`;
      expect(finished?.cleaned_at).toBeInstanceOf(Date);
      await sql`update artifacts.upload_sessions set expires_at = now() - interval '23 hours' where session_id = ${pending.sessionId}::uuid`;
      await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: pendingKey, Body: "late S3 completion" }));
      await storage.directUploads!.cleanup();
      await expect(raw(pendingKey)).rejects.toThrow();
      await sql`update artifacts.upload_sessions set expires_at = now() - interval '3 days' where target_id = ${id}`;
      await storage.directUploads!.cleanup();
      expect(await sql`select session_id from artifacts.upload_sessions where target_id = ${id}`).toHaveLength(22);
      expect((await request("/api/uploads/sessions", "POST", { requestId: cleaned[0]!.sessionId,
        kind: "html", filename: "plan.html", contentType: "text/html", totalBytes: 4, replaceId: id })).status).toBe(404);
    } finally {
      await sql`update artifacts.upload_sessions set expires_at = now() - interval '3 days' where target_id = ${id}`;
      await storage.deleteUpload(id);
    }
  });

  it("keeps ambiguous legacy recovery evidence while unrelated reads and later recovery continue", async () => {
    const created = await html("ambiguous retained body");
    const result = await (await request(created.path + "/complete")).json() as { id: string; url: string };
    const healthy = await html("unrelated live body");
    const other = await (await request(healthy.path + "/complete")).json() as { id: string; url: string };
    const [row] = await sql`select * from artifacts.objects where id = ${result.id}`;
    const operationId = crypto.randomUUID();
    const nextOperation = crypto.randomUUID();
    const nextArtifact = crypto.randomBytes(24).toString("base64url");
    const payload = JSON.stringify({ id: result.id, kind: "html", filename: row!.filename, contentType: row!.content_type,
      bytes: Number(row!.bytes), objectKey: row!.object_key, sha256: row!.sha256, now: row!.updated_at });
    await sql`delete from artifacts.objects where id = ${result.id}`;
    await sql`insert into artifacts.operations (operation_id, artifact_id, owner_id, lease_until, operation_kind, payload, created_at)
      values (${operationId}::uuid, ${result.id}, 'ambiguous-fixture', now() - interval '1 second', 'put_html', ${sql.json(payload)}, now() - interval '2 minutes'),
        (${nextOperation}::uuid, ${nextArtifact}, 'following-fixture', now() - interval '1 second', 'delete', null, now() - interval '1 minute')`;
    const log = vi.spyOn(console, "error");
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await sql`update artifacts.operations set lease_until = now() - interval '1 second' where operation_id = ${operationId}::uuid`;
        const response = await app(new Request(other.url));
        expect(response.status).toBe(200);
        expect(await response.text()).toContain("unrelated live body");
      }
      expect(await storage.getHtml(result.id)).toBeNull();
      expect((await app(new Request(result.url))).status).toBe(404);
      expect(await sql`select id from artifacts.objects where id = ${result.id}`).toHaveLength(0);
      const [retained] = await sql`select payload, lease_until > now() leased from artifacts.operations where operation_id = ${operationId}::uuid`;
      expect(retained?.payload).toBe(payload);
      expect(retained?.leased).toBe(true);
      expect(await raw(row!.object_key)).toBe("ambiguous retained body");
      expect(await sql`select operation_id from artifacts.operations where operation_id = ${nextOperation}::uuid`).toHaveLength(0);
      expect(log.mock.calls.map(([value]) => JSON.parse(value))).toContainEqual({ event: "publisher.artifact_recovery_needed",
        operationId, artifactId: result.id, reason: "legacy_base_missing" });
    } finally {
      log.mockRestore();
      await sql`delete from artifacts.operations where operation_id in (${operationId}::uuid, ${nextOperation}::uuid)`;
      await storage.deleteUpload(result.id);
      await storage.deleteUpload(other.id);
    }
  });

  it("stages replacements without changing identity or prior bytes and keeps exact receipts after restart and expiry", async () => {
    const created = await html("<h1>original</h1>", undefined, "original-project");
    const original = await (await request(created.path + "/complete")).json() as { id: string; url: string };
    const [before] = await sql`select * from artifacts.objects where id = ${original.id}`;
    const replacement = await html("<h1>replacement</h1>", original.id);
    expect(await raw(before!.object_key)).toBe("<h1>original</h1>");
    expect(await (await app(new Request(original.url))).text()).toContain("<h1>original</h1>");
    await storage.updateHtmlProject(original.id, "edited-during-upload");
    const response = await request(replacement.path + "/complete");
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result).toMatchObject({ id: original.id, url: original.url, project: "edited-during-upload",
      bytes: Buffer.byteLength("<h1>replacement</h1>"), sha256: digest(Buffer.from("<h1>replacement</h1>")) });
    const [after] = await sql`select * from artifacts.objects where id = ${original.id}`;
    expect(after!.created_at).toEqual(before!.created_at);
    expect(after!.object_key).not.toBe(before!.object_key);
    expect(await raw(after!.object_key)).toBe("<h1>replacement</h1>");
    expect(await raw(before!.object_key)).toBe("<h1>original</h1>");
    const newer = await html("<h1>newer</h1>", original.id);
    expect((await request(newer.path + "/complete")).status).toBe(201);
    expect(await (await request(replacement.path + "/complete")).json()).toEqual(result);
    await sql`update artifacts.upload_sessions set expires_at = now() - interval '3 days' where session_id = ${replacement.sessionId}::uuid`;
    await storage.directUploads!.cleanup();
    await storage.close?.();
    sql = postgres(databaseUrl!, { max: 3, idle_timeout: 1 });
    attach();
    expect(await (await request(replacement.path + "/complete")).json()).toEqual(result);
    const [receipt] = await sql`select receipt from artifacts.upload_sessions where session_id = ${replacement.sessionId}::uuid`;
    expect(receipt!.receipt).toMatchObject({ format: 1, before: { object_key: before!.object_key,
      project: "edited-during-upload", created_at: before!.created_at.toISOString() },
      after: { object_key: after!.object_key, sha256: result.sha256 } });
  });

  it("rejects a stale replacement and never rebinds its UUID after cleanup", async () => {
    const created = await html("old");
    const { id } = await (await request(created.path + "/complete")).json() as { id: string };
    const winner = await html("winner", id);
    const stale = await html("stale", id);
    expect((await request(winner.path + "/complete")).status).toBe(201);
    const conflict = await request(stale.path + "/complete");
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: "replace_conflict" });
    await sql`update artifacts.upload_sessions set expires_at = now() - interval '3 days' where session_id = ${stale.sessionId}::uuid`;
    await storage.directUploads!.cleanup();
    expect((await request(stale.path + "/complete")).status).toBe(404);
    const rebind = await request("/api/uploads/sessions", "POST", { requestId: stale.sessionId,
      kind: "html", filename: "plan.html", contentType: "text/html", totalBytes: 5, replaceId: id });
    expect(rebind.status).toBe(404);
    const [current] = await sql`select object_key from artifacts.objects where id = ${id}`;
    expect(await raw(current!.object_key)).toBe("winner");
  });

  it("serves retained PDF MIME and binary-classified PDFs inline with an explicit signed download", async () => {
    for (const contentType of ["application/pdf", "application/octet-stream"]) {
      const bytes = Buffer.from("%PDF-1.4\nowned PDF fixture\n%%EOF\n");
      const session = await initialize(bytes.length, { filename: "résumé.pdf", contentType });
      await put(session, 1, bytes);
      const result = await (await request(session.path + "/complete")).json() as { id: string; url: string; downloadUrl: string };
      expect(result.downloadUrl).toBe(result.url + "?download=1");
      const redirect = await app(new Request(result.url));
      expect(redirect.status).toBe(307);
      const viewed = await fetch(redirect.headers.get("location")!);
      expect(viewed.headers.get("content-type")).toBe("application/pdf");
      expect(viewed.headers.get("content-disposition")).toMatch(/^inline;/);
      expect(Buffer.from(await viewed.arrayBuffer())).toEqual(bytes);
      const head = await app(new Request(result.url, { method: "HEAD" }));
      expect(head.headers.get("content-type")).toBe("application/pdf");
      expect(head.headers.get("content-disposition")).toMatch(/^inline;/);
      const ranged = await fetch(redirect.headers.get("location")!, { headers: { Range: "bytes=0-7" } });
      expect(ranged.status).toBe(206);
      expect(Buffer.from(await ranged.arrayBuffer())).toEqual(bytes.subarray(0, 8));
      const conditional = await app(new Request(result.url, { headers: { "If-None-Match": head.headers.get("etag")! } }));
      expect(conditional.status).toBe(304);
      const download = await app(new Request(result.downloadUrl));
      const downloaded = await fetch(download.headers.get("location")!);
      expect(downloaded.headers.get("content-disposition")).toMatch(/^attachment;/);
      expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
      await storage.deleteUpload(result.id);
      expect((await app(new Request(result.url))).status).toBe(404);
      expect((await fetch(redirect.headers.get("location")!)).status).toBe(404);
    }
  });

  it("keeps legacy writers, stale journal recovery, and project edits on the same conditional commit", async () => {
    const form = new FormData();
    form.append("file", new Blob(["legacy original"], { type: "text/html" }), "legacy.html");
    form.append("project", "original-project");
    const original = await (await app(new Request(origin + "/api/uploads", { method: "POST",
      headers: { Authorization: "Bearer transfer-local-token" }, body: form }))).json() as { id: string; url: string };
    const [before] = await sql`select * from artifacts.objects where id = ${original.id}`;
    const direct = await html("stale direct replacement", original.id);
    const update = new FormData();
    update.append("file", new Blob(["legacy winner"], { type: "text/html" }), "updated.html");
    expect((await app(new Request(`${origin}/api/uploads/${original.id}`, { method: "PUT",
      headers: { Authorization: "Bearer transfer-local-token" }, body: update }))).status).toBe(200);
    expect((await request(direct.path + "/complete")).status).toBe(409);
    expect(await raw(before!.object_key)).toBe("legacy original");
    const [current] = await sql`select * from artifacts.objects where id = ${original.id}`;
    expect(await raw(current!.object_key)).toBe("legacy winner");
    const payload = { id: original.id, kind: "html", filename: "legacy.html", contentType: "text/html; charset=utf-8",
      bytes: 15, objectKey: before!.object_key, project: "stale-project", sha256: digest(Buffer.from("legacy original")), now: before!.updated_at };
    const operationId = crypto.randomUUID();
    await sql`insert into artifacts.operations (operation_id, artifact_id, owner_id, lease_until, operation_kind, payload)
      values (${operationId}::uuid, ${original.id}, 'stale-fixture', now() - interval '1 second', 'put_html', ${sql.json(JSON.stringify(payload))})`;
    const recovered = await storage.getHtml(original.id, { headOnly: true });
    recovered?.body.destroy();
    expect(recovered?.sha256).toBe(digest(Buffer.from("legacy winner")));
    expect(recovered?.project).toBe("original-project");
    expect((await sql`select operation_id from artifacts.operations where operation_id = ${operationId}::uuid`).length).toBe(0);
    const projectOperation = crypto.randomUUID();
    await sql`insert into artifacts.operations (operation_id, artifact_id, owner_id, lease_until, operation_kind, payload)
      values (${projectOperation}::uuid, ${original.id}, 'project-fixture', now() + interval '1 hour', 'put_html',
        ${sql.json({ ...payload, objectKey: current!.object_key, sha256: current!.sha256, bytes: 13, now: current!.updated_at })})`;
    await storage.updateHtmlProject(original.id, "new-project");
    await sql`update artifacts.operations set lease_until = now() - interval '1 second' where operation_id = ${projectOperation}::uuid`;
    const project = await storage.getHtml(original.id, { headOnly: true });
    project?.body.destroy();
    expect(project?.project).toBe("new-project");
    await storage.deleteUpload(original.id);
    await sql`insert into artifacts.operations (operation_id, artifact_id, owner_id, lease_until, operation_kind, payload)
      values (${crypto.randomUUID()}::uuid, ${original.id}, 'revoked-fixture', now() - interval '1 second', 'put_html', ${sql.json(payload)})`;
    expect(await storage.getHtml(original.id)).toBeNull();
    expect((await sql`select id from artifacts.objects where id = ${original.id} and revoked_at is null`).length).toBe(0);
    await expect(raw(before!.object_key)).rejects.toThrow();
    await expect(raw(current!.object_key)).rejects.toThrow();
  });

  it("recovers interrupted replacement completion while keeping the old body until its conditional commit", async () => {
    const created = await html("before interruption");
    const { id } = await (await request(created.path + "/complete")).json() as { id: string };
    const [before] = await sql`select * from artifacts.objects where id = ${id}`;
    const replacement = await html("after interruption", id);
    const complete = bucket.complete.bind(bucket);
    const lost = vi.spyOn(bucket, "complete").mockImplementationOnce(async (...args) => {
      await complete(...args);
      throw new Error("replacement completion response lost");
    });
    expect((await request(replacement.path + "/complete")).status).toBe(500);
    lost.mockRestore();
    expect(await raw(before!.object_key)).toBe("before interruption");
    await sql.unsafe(`create function public.reject_replacement_commit() returns trigger language plpgsql as $$ begin raise exception 'replacement database interruption'; end $$`);
    await sql.unsafe(`create trigger reject_replacement_commit before update on artifacts.objects for each row execute function public.reject_replacement_commit()`);
    try { expect((await request(replacement.path + "/complete")).status).toBe(500); }
    finally { await sql.unsafe("drop trigger reject_replacement_commit on artifacts.objects"); await sql.unsafe("drop function public.reject_replacement_commit()"); }
    const [unchanged] = await sql`select object_key from artifacts.objects where id = ${id}`;
    expect(unchanged!.object_key).toBe(before!.object_key);
    await storage.close?.();
    sql = postgres(databaseUrl!, { max: 3, idle_timeout: 1 });
    attach();
    const result = await (await request(replacement.path + "/complete")).json();
    expect(result).toMatchObject({ id, sha256: digest(Buffer.from("after interruption")) });
    expect(await (await request(replacement.path + "/complete")).json()).toEqual(result);
    expect(await raw(before!.object_key)).toBe("before interruption");
  });

  it("prevents replacement resurrection when revocation wins during stored-byte verification", async () => {
    const created = await html("revocation original");
    const { id } = await (await request(created.path + "/complete")).json() as { id: string };
    const replacement = await html("must never publish", id);
    const verify = bucket.verify.bind(bucket);
    const revoke = vi.spyOn(bucket, "verify").mockImplementationOnce(async (...args) => {
      const hash = await verify(...args);
      await storage.deleteUpload(id);
      return hash;
    });
    expect((await request(replacement.path + "/complete")).status).toBe(404);
    revoke.mockRestore();
    await storage.directUploads!.cleanup();
    expect(await storage.getHtml(id)).toBeNull();
    expect((await request(replacement.path + "/complete")).status).toBe(404);
    const multipart = await client.send(new ListMultipartUploadsCommand({ Bucket: config.bucket, Prefix: `transfers/${id}/` }));
    expect(multipart.Uploads ?? []).toEqual([]);
  });

  it("rejects a changed source before committing a recovered replacement and preserves original-source retries", async () => {
    const created = await html("canonical before recovery");
    const { id } = await (await request(created.path + "/complete")).json() as { id: string };
    const [before] = await sql`select * from artifacts.objects where id = ${id}`;
    const original = "<h1>old staged</h1>";
    const changed = "<h1>new staged</h1>";
    const expected = digest(Buffer.from(original));
    const wrong = digest(Buffer.from(changed));
    const replacement = await html(original, id);
    await sql.unsafe(`create function public.reject_expected_hash_commit() returns trigger language plpgsql as $$ begin raise exception 'expected hash database interruption'; end $$`);
    await sql.unsafe(`create trigger reject_expected_hash_commit before update on artifacts.objects for each row when (old.id = '${id}') execute function public.reject_expected_hash_commit()`);
    try {
      expect((await request(replacement.path + "/complete", "POST", { sha256: expected })).status).toBe(500);
    } finally {
      await sql.unsafe("drop trigger reject_expected_hash_commit on artifacts.objects");
      await sql.unsafe("drop function public.reject_expected_hash_commit()");
    }
    try {
      const [interrupted] = await sql`select state, manifest, parts, upload_id, sha256, receipt from artifacts.upload_sessions
        where session_id = ${replacement.sessionId}::uuid`;
      expect(interrupted?.state).toBe("completing");
      expect(interrupted?.manifest).toHaveLength(1);
      const mismatch = await request(replacement.path + "/complete", "POST", { sha256: wrong });
      expect(mismatch.status).toBe(409);
      expect(await mismatch.json()).toMatchObject({ error: "source_changed" });
      expect(await sql`select * from artifacts.objects where id = ${id}`).toEqual([before]);
      expect(await sql`select state, manifest, parts, upload_id, sha256, receipt from artifacts.upload_sessions
        where session_id = ${replacement.sessionId}::uuid`).toEqual([interrupted]);
      const [session] = await sql`select artifact_id from artifacts.upload_sessions where session_id = ${replacement.sessionId}::uuid`;
      expect(await raw(`transfers/${id}/${session!.artifact_id}`)).toBe(original);
      expect(await raw(before!.object_key)).toBe("canonical before recovery");
      const completed = await request(replacement.path + "/complete", "POST", { sha256: expected });
      expect(completed.status).toBe(201);
      const result = await completed.json();
      expect(result).toMatchObject({ id, sha256: expected });
      expect(await (await request(replacement.path + "/complete", "POST", { sha256: expected })).json()).toEqual(result);
      expect(await (await request(replacement.path + "/complete")).json()).toEqual(result);
      const published = await sql`select * from artifacts.objects where id = ${id}`;
      const completedSession = await sql`select * from artifacts.upload_sessions where session_id = ${replacement.sessionId}::uuid`;
      const staleSource = await request(replacement.path + "/complete", "POST", { sha256: wrong });
      expect(staleSource.status).toBe(409);
      expect(await staleSource.json()).toMatchObject({ error: "source_changed" });
      expect(await sql`select * from artifacts.objects where id = ${id}`).toEqual(published);
      expect(await sql`select * from artifacts.upload_sessions where session_id = ${replacement.sessionId}::uuid`).toEqual(completedSession);
    } finally { await storage.deleteUpload(id); }
  });

  it("resumes 85 MiB after a web restart, then completes exactly once without application body uploads", async () => {
    const beforeApplication = applicationUploadBytes;
    const beforeBucket = bucketUploadBytes;
    const total = 85 * 1024 * 1024 + 17;
    const session = await initialize(total);
    const whole = crypto.createHash("sha256");
    for (let number = 1; number <= session.totalParts; number += 1) {
      const bytes = Buffer.alloc(Math.min(DIRECT_PART_BYTES, total - (number - 1) * DIRECT_PART_BYTES), number);
      whole.update(bytes);
      await put(session, number, bytes);
      if (number === 1) {
        await storage.close?.();
        sql = postgres(databaseUrl!, { max: 3, idle_timeout: 1 });
        attach();
        const status = await request(session.path, "GET");
        expect(await status.json()).toMatchObject({ state: "uploading", uploaded: [1] });
      }
    }
    const first = await request(session.path + "/complete");
    expect(first.status).toBe(201);
    const completed = await first.json() as { id: string; bytes: number; sha256: string; url: string };
    expect(completed.bytes).toBe(total);
    expect(completed.sha256).toBe(whole.digest("hex"));
    const second = await request(session.path + "/complete");
    expect(await second.json()).toEqual(completed);
    expect((await sql`select id from artifacts.objects where id = ${completed.id}`).length).toBe(1);
    expect(bucketUploadBytes - beforeBucket).toBe(total);
    expect(applicationUploadBytes - beforeApplication).toBeLessThan(2048);
    const read = await app(new Request(completed.url));
    expect(read.status).toBe(307);
    const actual = await fetch(read.headers.get("location")!, { headers: { Range: "bytes=0-1023" } });
    expect(actual.status).toBe(206);
    expect((await actual.arrayBuffer()).byteLength).toBe(1024);
    console.info(JSON.stringify({ evidence: "direct-large-transfer", payloadBytes: total,
      applicationControlBytes: applicationUploadBytes - beforeApplication, applicationFileBodyBytes: 0,
      bucketUploadBytes: bucketUploadBytes - beforeBucket, restartRecovered: true, repeatedCompletion: true }));
  }, 60_000);

  it("recovers a lost S3 completion response and a failed canonical metadata commit", async () => {
    const session = await initialize(7);
    await put(session, 1, Buffer.from("durable"));
    const original = bucket.complete.bind(bucket);
    const failure = vi.spyOn(bucket, "complete").mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error("Completion response lost");
    });
    expect((await request(session.path + "/complete")).status).toBe(500);
    expect((await sql`select id from artifacts.objects where id = (select artifact_id from artifacts.upload_sessions where session_id = ${session.sessionId}::uuid)`).length).toBe(0);
    failure.mockRestore();
    await sql.unsafe(`create function public.reject_transfer_commit() returns trigger language plpgsql as $$ begin raise exception 'isolated commit interruption'; end $$`);
    await sql.unsafe(`create trigger reject_transfer_commit before insert on artifacts.objects for each row execute function public.reject_transfer_commit()`);
    try { expect((await request(session.path + "/complete")).status).toBe(500); }
    finally { await sql.unsafe("drop trigger reject_transfer_commit on artifacts.objects"); await sql.unsafe("drop function public.reject_transfer_commit()"); }
    await storage.close?.();
    sql = postgres(databaseUrl!, { max: 3, idle_timeout: 1 });
    attach();
    expect((await request(session.path + "/complete")).status).toBe(201);
    expect((await request(session.path + "/complete")).status).toBe(201);
  });

  it("rejects missing parts, wrong audience, expired, and aborted sessions", async () => {
    const session = await initialize(10);
    expect((await request(session.path + "/complete")).status).toBe(409);
    expect((await request(session.path.replace("/api/uploads/", "/api/external-uploads/"), "GET")).status).toBe(404);
    await sql`update artifacts.upload_sessions set expires_at = now() - interval '1 second' where session_id = ${session.sessionId}::uuid`;
    expect((await request(session.path, "GET")).status).toBe(404);
    expect((await request(session.path + "/parts", "POST", { number: 1, sha256: "0".repeat(64) })).status).toBe(404);
    expect((await request(session.path + "/complete")).status).toBe(404);
    await storage.directUploads!.cleanup();
    const aborted = await initialize(4);
    const signed = await put(aborted, 1, Buffer.from("test"));
    expect((await request(aborted.path, "DELETE")).status).toBe(204);
    expect((await request(aborted.path, "DELETE")).status).toBe(204);
    expect((await request(aborted.path + "/complete")).status).toBe(404);
    expect((await fetch(signed, { method: "PUT", body: Buffer.from("test") })).ok).toBe(false);
  });

  it("checks bucket bytes rather than client size, hashes, metadata, or ETags", async () => {
    const incorrect = await initialize(4);
    await put(incorrect, 1, Buffer.from("test"), digest(Buffer.from("fake")));
    const checksum = await request(incorrect.path + "/complete");
    expect(checksum.status).toBe(422);
    expect(await checksum.json()).toMatchObject({ error: "checksum_mismatch" });
    const wrongSize = await initialize(4);
    await put(wrongSize, 1, Buffer.from("test"));
    const [row] = await sql<{ upload_id: string; artifact_id: string }[]>`select upload_id, artifact_id from artifacts.upload_sessions where session_id = ${wrongSize.sessionId}::uuid`;
    await client.send(new UploadPartCommand({ Bucket: config.bucket, Key: `transfers/${row!.artifact_id}`, UploadId: row!.upload_id, PartNumber: 1, Body: Buffer.from("x"), ContentLength: 1 }));
    const size = await request(wrongSize.path + "/complete");
    expect(size.status).toBe(422);
    expect(await size.json()).toMatchObject({ error: "size_mismatch" });
    await storage.directUploads!.cleanup();
    expect((await sql`select id from artifacts.objects where id in (select artifact_id from artifacts.upload_sessions where session_id in (${incorrect.sessionId}::uuid, ${wrongSize.sessionId}::uuid))`).length).toBe(0);
  });

  it("isolates guest owners and revocation, including a revoke during verification", async () => {
    const first = await links.create(new Date(Date.now() + 60_000));
    const other = await links.create(new Date(Date.now() + 60_000));
    const session = await initialize(4, { base: `/api/drop/${first.token}/uploads/sessions` });
    expect((await request(session.path.replace(first.token, other.token), "GET")).status).toBe(404);
    await put(session, 1, Buffer.from("test"));
    const original = bucket.verify.bind(bucket);
    const revoke = vi.spyOn(bucket, "verify").mockImplementationOnce(async (...args) => {
      const hash = await original(...args);
      await links.revoke(first.id, new Date());
      return hash;
    });
    expect((await request(session.path + "/complete")).status).toBe(404);
    revoke.mockRestore();
    expect((await request(session.path + "/parts", "POST", { number: 1, sha256: digest(Buffer.from("test")) })).status).toBe(404);
    await storage.directUploads!.cleanup();
    await links.revoke(other.id, new Date());
  });

  it("bounds completion concurrency and freezes parts until publication", async () => {
    const one = await initialize(4);
    const two = await initialize(4);
    await put(one, 1, Buffer.from("test"));
    await put(two, 1, Buffer.from("test"));
    const original = bucket.verify.bind(bucket);
    const entered = deferred();
    const release = deferred();
    const pause = vi.spyOn(bucket, "verify").mockImplementationOnce(async (...args) => {
      entered.resolve(); await release.promise; return original(...args);
    });
    const pending = request(one.path + "/complete");
    await entered.promise;
    try {
      expect((await request(one.path + "/complete")).status).toBe(409);
      expect((await request(one.path + "/parts", "POST", { number: 1, sha256: digest(Buffer.from("test")) })).status).toBe(409);
      expect((await request(two.path + "/complete")).status).toBe(503);
    } finally { release.resolve(); }
    expect((await pending).status).toBe(201);
    pause.mockRestore();
    expect((await request(two.path + "/complete")).status).toBe(201);
  });

  it("serializes UUID case variants while completion verifies stored bytes", async () => {
    const session = await initialize(4, { requestId: crypto.randomUUID().replace(/^./, "a") });
    await put(session, 1, Buffer.from("test"));
    const uppercasePath = session.path.replace(session.sessionId, session.sessionId.toUpperCase());
    const original = bucket.verify.bind(bucket);
    const entered = deferred();
    const release = deferred();
    const pause = vi.spyOn(bucket, "verify").mockImplementationOnce(async (...args) => {
      entered.resolve(); await release.promise; return original(...args);
    });
    const pending = request(session.path + "/complete");
    await entered.promise;
    const before = await sql`select state, parts, manifest, upload_id from artifacts.upload_sessions where session_id = ${session.sessionId}::uuid`;
    try {
      const operations = [
        () => request(uppercasePath + "/parts", "POST", { number: 1, sha256: digest(Buffer.from("test")) }),
        () => request(uppercasePath + "/complete"),
        () => request(uppercasePath, "DELETE"),
        () => request("/api/uploads/sessions", "POST", { requestId: session.sessionId.toUpperCase(),
          filename: "fixture.bin", contentType: "application/octet-stream", totalBytes: 4, kind: "file" })
      ];
      for (const operation of operations) {
        const response = await operation();
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ error: "upload_busy" });
      }
      expect(await sql`select state, parts, manifest, upload_id from artifacts.upload_sessions where session_id = ${session.sessionId}::uuid`).toEqual(before);
      expect((await sql`select id from artifacts.objects where id = (select artifact_id from artifacts.upload_sessions where session_id = ${session.sessionId}::uuid)`).length).toBe(0);
    } finally {
      release.resolve();
      expect((await pending).status).toBe(201);
      pause.mockRestore();
    }
    expect((await request(uppercasePath + "/complete")).status).toBe(201);
  });

  it("recovers and aborts multipart initialization with a lost upload ID", async () => {
    const original = bucket.create.bind(bucket);
    const create = vi.spyOn(bucket, "create").mockImplementationOnce(async (...args) => { await original(...args); throw new Error("Create response lost"); });
    const id = crypto.randomUUID();
    const base = "/api/uploads/sessions";
    sessions.push({ id, base });
    expect((await request(base, "POST", { requestId: id, filename: "lost.bin", contentType: "application/octet-stream", totalBytes: 4 })).status).toBe(500);
    create.mockRestore();
    const [row] = await sql<{ artifact_id: string }[]>`select artifact_id from artifacts.upload_sessions where session_id = ${id}::uuid`;
    const prefix = `transfers/${row!.artifact_id}`;
    expect((await client.send(new ListMultipartUploadsCommand({ Bucket: config.bucket, Prefix: prefix }))).Uploads).toHaveLength(1);
    await sql`update artifacts.upload_sessions set expires_at = now() - interval '1 second' where session_id = ${id}::uuid`;
    await storage.directUploads!.cleanup();
    expect((await client.send(new ListMultipartUploadsCommand({ Bucket: config.bucket, Prefix: prefix }))).Uploads ?? []).toHaveLength(0);
  });

  it("continues cleanup after one storage failure and retains its retry record", async () => {
    const first = await initialize(4);
    const second = await initialize(4);
    await sql`update artifacts.upload_sessions set expires_at = now() - interval '1 second'
      where session_id in (${first.sessionId}::uuid, ${second.sessionId}::uuid)`;
    const remove = vi.spyOn(bucket, "remove").mockRejectedValueOnce(new Error("Isolated storage outage"));
    await storage.directUploads!.cleanup();
    const rows = await sql<{ cleaned: boolean }[]>`select cleaned_at is not null cleaned from artifacts.upload_sessions
      where session_id in (${first.sessionId}::uuid, ${second.sessionId}::uuid)`;
    expect(rows.filter(row => row.cleaned)).toHaveLength(1);
    remove.mockRestore();
    await storage.directUploads!.cleanup();
    expect((await sql`select session_id from artifacts.upload_sessions where cleaned_at is null
      and session_id in (${first.sessionId}::uuid, ${second.sessionId}::uuid)`).length).toBe(0);
  });

  it("preserves protected HTML, stable replacement URLs, ranges, HEAD, and conditional reads", async () => {
    const html = Buffer.from('<html><head></head><body>private fixture</body></html>');
    const session = await initialize(html.length, { filename: "fixture.html", kind: "html", contentType: "text/html", project: "transfer-check" });
    await put(session, 1, html);
    const response = await request(session.path + "/complete");
    const result = await response.json() as { id: string; url: string };
    const page = await app(new Request(result.url));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("sandbox");
    expect(page.headers.get("location")).toBeNull();
    expect(await page.text()).toContain("private fixture");
    const form = new FormData(); form.append("file", new Blob(["<p>replaced</p>"], { type: "text/html" }), "fixture.html");
    const replaced = await app(new Request(`${origin}/api/uploads/${result.id}`, { method: "PUT", headers: { Authorization: "Bearer transfer-local-token" }, body: form }));
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({ id: result.id, url: result.url, project: "transfer-check" });
    await sql.unsafe(`create function public.reject_html_commit() returns trigger language plpgsql as $$ begin raise exception 'isolated replacement interruption'; end $$`);
    await sql.unsafe(`create trigger reject_html_commit before update on artifacts.objects for each row execute function public.reject_html_commit()`);
    const recoveredHtml = "<p>recovered after restart</p>";
    const interrupted = new FormData(); interrupted.append("file", new Blob([recoveredHtml], { type: "text/html" }), "fixture.html");
    try {
      expect((await app(new Request(`${origin}/api/uploads/${result.id}`, { method: "PUT", headers: { Authorization: "Bearer transfer-local-token" }, body: interrupted }))).status).toBe(500);
    } finally {
      await sql.unsafe("drop trigger reject_html_commit on artifacts.objects");
      await sql.unsafe("drop function public.reject_html_commit()");
    }
    const [operation] = await sql<{ encoding: string }[]>`select jsonb_typeof(payload) encoding from artifacts.operations where artifact_id = ${result.id}`;
    expect(operation?.encoding).toBe("object");
    // Reproduce pending records written by the previous JSON-string encoder.
    await sql`update artifacts.operations set lease_until = now() - interval '1 second', payload = to_jsonb(payload::text) where artifact_id = ${result.id}`;
    expect((await storage.getHtml(result.id, { headOnly: true }))?.sha256).toBe(digest(Buffer.from(recoveredHtml)));
    expect((await sql`select operation_id from artifacts.operations where artifact_id = ${result.id}`).length).toBe(0);
    const file = await initialize(7, { filename: "fixture.mp4", contentType: "video/mp4" });
    await put(file, 1, Buffer.from("1234567"));
    const completed = await (await request(file.path + "/complete")).json() as { id: string; url: string; sha256: string };
    const head = await app(new Request(completed.url, { method: "HEAD" }));
    expect(head.headers.get("content-length")).toBe("7");
    const notModified = await app(new Request(completed.url, { headers: { "If-None-Match": head.headers.get("etag")! } }));
    expect(notModified.status).toBe(304);
    expect((await app(new Request(completed.url, { headers: { Range: "bytes=1-3", "If-None-Match": head.headers.get("etag")! } }))).status).toBe(304);
    expect((await app(new Request(completed.url, { headers: { "If-Match": '"wrong"' } }))).status).toBe(412);
    const matched = await app(new Request(completed.url, { headers: { "If-Match": head.headers.get("etag")! } }));
    expect(matched.status).toBe(200); await matched.body?.cancel();
    const newContent = await app(new Request(completed.url, { headers: { "If-None-Match": '"wrong"', "If-Modified-Since": "Thu, 01 Jan 2099 00:00:00 GMT" } }));
    expect(newContent.status).toBe(200); await newContent.body?.cancel();
    const partial = await app(new Request(completed.url, { headers: { Range: "bytes=1-3", "If-Range": head.headers.get("etag")! } }));
    expect(partial.status).toBe(206); expect(await partial.text()).toBe("234");
    expect(partial.headers.get("content-length")).toBe("3");
    const redirect = await app(new Request(completed.url, { headers: { Range: "bytes=1-3" } }));
    const storageRead = await fetch(redirect.headers.get("location")!, { headers: { Range: "bytes=1-3", Origin: "null" } });
    expect(storageRead.status).toBe(206); expect(await storageRead.text()).toBe("234");
    expect(["*", "null"]).toContain(storageRead.headers.get("access-control-allow-origin"));
    await storage.deleteUpload(completed.id);
    expect((await app(new Request(completed.url))).status).toBe(404);
    expect((await fetch(redirect.headers.get("location")!)).ok).toBe(false);
    expect((await request(file.path + "/complete")).status).toBe(404);
  });

  it("permits browser upload CORS only for the selected Tools origin and keeps the bucket private", async () => {
    const allowed = await fetch(`${config.endpoint}/${config.bucket}/transfers/cors-check`, { method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" } });
    expect(allowed.ok).toBe(true); expect(allowed.headers.get("access-control-allow-origin")).toBe(origin);
    expect(allowed.headers.get("access-control-allow-methods")).toContain("PUT");
    const denied = await fetch(`${config.endpoint}/${config.bucket}/transfers/cors-check`, { method: "OPTIONS",
      headers: { Origin: "http://untrusted.example", "Access-Control-Request-Method": "PUT" } });
    expect(denied.headers.get("access-control-allow-methods") ?? "").not.toContain("PUT");
    expect((await fetch(`${config.endpoint}/${config.bucket}/transfers/cors-check`)).status).toBe(403);
    const noToken = await app(new Request(origin + "/api/uploads/sessions", { method: "POST" }));
    expect(noToken.status).toBe(401);
    const crossOrigin = await app(new Request(origin + "/api/external-uploads/sessions", { method: "POST", headers: { Origin: "https://untrusted.example" } }));
    expect(crossOrigin.status).toBe(403);
    // The completed body prefix is excluded from the legacy pages/files scan.
    const [row] = await sql<{ object_key: string }[]>`select object_key from artifacts.objects where revoked_at is null and object_key like 'transfers/%' limit 1`;
    expect(row?.object_key).toMatch(/^transfers\//);
    expect(await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: row!.object_key }))).toHaveProperty("ContentLength");
  });
});

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
