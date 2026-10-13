import crypto from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HeadObjectCommand, ListMultipartUploadsCommand, PutBucketCorsCommand, S3Client, UploadPartCommand } from "@aws-sdk/client-s3";
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
  let bucket: ReturnType<typeof createMultipartStorage>;
  let links: ReturnType<typeof createPostgresUploadLinkRepository>;
  let client: S3Client;
  let app: ReturnType<typeof createFetchApp>;
  const sessions: Array<{ id: string; base: string }> = [];
  let applicationUploadBytes = 0;
  let bucketUploadBytes = 0;

  function attach() {
    storage = createMetadataBackedUploadStorage(createS3UploadStorage(config), sql);
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

  async function initialize(bytes: number, options: { base?: string; filename?: string; kind?: "html" | "file"; contentType?: string; project?: string } = {}) {
    const base = options.base ?? "/api/uploads/sessions";
    const id = crypto.randomUUID();
    const response = await request(base, "POST", { requestId: id, filename: options.filename ?? "fixture.bin",
      contentType: options.contentType ?? "application/octet-stream", totalBytes: bytes, kind: options.kind ?? "file", ...(options.project ? { project: options.project } : {}) });
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
    await sql.unsafe(`create trigger reject_html_commit before insert on artifacts.objects for each row execute function public.reject_html_commit()`);
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
    const [row] = await sql<{ object_key: string }[]>`select object_key from artifacts.objects where object_key like 'transfers/%' limit 1`;
    expect(row?.object_key).toMatch(/^transfers\//);
    expect(await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: row!.object_key }))).toHaveProperty("ContentLength");
  });
});

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
