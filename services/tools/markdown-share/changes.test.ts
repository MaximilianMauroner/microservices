import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDocumentChanges } from "./changes";
import { createMarkdownShareRepository } from "./repository";
import { applyMarkdownShareSchema } from "./schema";

const url = process.env.MARKDOWN_SHARE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || !parsed.pathname.endsWith("_test")) throw new Error("Markdown tests require a loopback *_test database.");
}
describe.skipIf(!url)("document change subscriptions", () => {
  const sql = url ? postgres(url, { max: 1 }) : undefined;
  const repository = url ? createMarkdownShareRepository(url) : undefined;
  const changes = url ? createDocumentChanges(url) : undefined;
  const second = url ? createDocumentChanges(url) : undefined;
  let token = "";
  beforeAll(async () => {
    await applyMarkdownShareSchema(sql!);
    token = (await repository!.create({ requestId: randomUUID(), filename: "notify.md", format: "markdown", markdown: "" })).token;
  });
  afterAll(async () => {
    await Promise.all([changes!.close(), second!.close(), repository!.close()]);
    await sql!`DELETE FROM tools.markdown_documents WHERE token=${token}`;
    await sql!.end();
  });
  it("wakes multiple replicas on a committed write and isolates documents", async () => {
    const a = changes!.subscribe(token);
    const b = second!.subscribe(token);
    const other = changes!.subscribe("another-token", undefined, 10000);
    await Promise.all([a.ready,b.ready,other.ready]);
    let otherWoke = false; void other.promise.then(() => { otherWoke=true; });
    await repository!.setPinned(token,true);
    await Promise.all([a.promise,b.promise]);
    expect(otherWoke).toBe(false);
    other.cancel(); await other.promise;
  });
  it("releases aborted subscriptions and supports a new subscription after idle", async () => {
    const abort = new AbortController();
    const waiting = changes!.subscribe(token,abort.signal);
    await waiting.ready;
    abort.abort();
    await waiting.promise;
    const next = changes!.subscribe(token);
    await next.ready;
    await repository!.setPinned(token,false);
    await next.promise;
    const aborted = new AbortController(); aborted.abort();
    await changes!.wait(token,aborted.signal);
    const timeout = changes!.subscribe(token,undefined,10);
    await timeout.ready; await timeout.promise;
  });
  it("reuses the connection during a burst and releases it after two idle seconds", async () => {
    await second!.close();
    const first = changes!.subscribe(token);
    await first.ready;
    const before = await sql!`SELECT pid FROM pg_stat_activity WHERE application_name='markdown-share-changes' AND datname=current_database() ORDER BY pid`;
    expect(before).toHaveLength(1);
    first.cancel(); await first.promise;
    await new Promise(resolve => setTimeout(resolve,1100));
    const next = changes!.subscribe(token);
    await next.ready;
    await new Promise(resolve => setTimeout(resolve,1100));
    const during = await sql!`SELECT pid FROM pg_stat_activity WHERE application_name='markdown-share-changes' AND datname=current_database() ORDER BY pid`;
    expect(during.map(row => row.pid)).toEqual(before.map(row => row.pid));
    expect(during.length).toBeGreaterThan(0);
    next.cancel(); await next.promise;
    await expect.poll(async () => (await sql!`SELECT pid FROM pg_stat_activity WHERE application_name='markdown-share-changes' AND datname=current_database()`).length, { timeout: 4000, interval: 50 }).toBe(0);
  },10000);
  it("wakes readers after a listener connection reconnects", async () => {
    const waiting = changes!.subscribe(token,undefined,10000);
    await waiting.ready;
    const terminated = await sql!`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='markdown-share-changes' AND datname=current_database()`;
    expect(terminated.length).toBeGreaterThan(0);
    await waiting.promise;
  }, 15000);
  it("releases the database listener when no subscriptions remain", async () => {
    const waiting = changes!.subscribe(token);
    await waiting.ready;
    await Promise.all([changes!.close(),second!.close()]);
    await waiting.promise;
    const rows = await sql!`SELECT pid FROM pg_stat_activity WHERE application_name='markdown-share-changes' AND datname=current_database()`;
    expect(rows).toHaveLength(0);
  });
});
