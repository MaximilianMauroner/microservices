import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMarkdownShareRepository } from "../../markdown-share/repository";
import { applyMarkdownShareSchema } from "../../markdown-share/schema";

const url = process.env.MARKDOWN_SHARE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || !parsed.pathname.endsWith("_test")) throw new Error("Markdown tests require a loopback *_test database.");
}
const insert = (text: string, from = 1) => ({ stepType: "replace", from, to: from, slice: { content: [{ type: "text", text }] } });
describe.skipIf(!url)("PostgreSQL document aggregate", () => {
  const sql = url ? postgres(url, { max: 2 }) : undefined;
  const repository = url ? createMarkdownShareRepository(url) : undefined;
  const second = url ? createMarkdownShareRepository(url) : undefined;
  const tokens: string[] = [];
  async function create(markdown = "abc") {
    const input = { requestId: randomUUID(), filename: "example.md", format: "markdown" as const, markdown };
    const doc = await repository!.create(input, "admin-subject"); tokens.push(doc.token); return { doc, input };
  }
  beforeAll(async () => { await applyMarkdownShareSchema(sql!, "admin-subject"); });
  afterAll(async () => {
    if (tokens.length) await sql!`DELETE FROM tools.markdown_documents WHERE token IN ${sql!(tokens)}`;
    await Promise.all([repository!.close(), second!.close(), sql!.end()]);
  });
  it("creates idempotently, rejects changed requests, and survives a repository restart", async () => {
    const { doc, input } = await create();
    expect(doc.token).toMatch(/^[0-9a-f]{64}$/);
    expect(await second!.create(input, "admin-subject")).toEqual(doc);
    await expect(second!.create({ ...input, markdown: "changed" }, "admin-subject")).rejects.toMatchObject({ data: { code: "INVALID_EDITOR_PAYLOAD" } });
    const restarted = createMarkdownShareRepository(url!);
    try { expect(await restarted.open(doc.token)).toMatchObject({ version: 0, content: { content: [{ content: [{ text: "abc" }] }] } }); }
    finally { await restarted.close(); }
  });
  it("serializes concurrent editors, confirms retries without duplication, and preserves full steps", async () => {
    const { doc } = await create();
    const [a,b] = await Promise.all([
      repository!.submit(doc.token, { version: 0, clientId: "a", steps: [insert("A")] }),
      second!.submit(doc.token, { version: 0, clientId: "b", steps: [insert("B")] }),
    ]);
    expect([a.status,b.status].sort()).toEqual(["rebase","synced"]);
    const winner = a.status === "synced" ? "a" : "b";
    const retry = await second!.submit(doc.token, { version: 0, clientId: winner, steps: [insert(winner.toUpperCase())] });
    expect(retry).toMatchObject({ status: "rebase", version: 1, clientIds: [winner] });
    expect((await repository!.open(doc.token))!.version).toBe(1);
    const loser = winner === "a" ? "b" : "a";
    expect(await second!.submit(doc.token, { version: 1, clientId: loser, steps: [insert(loser.toUpperCase(),2)] })).toMatchObject({ status: "synced", version: 2 });
    expect((await repository!.updates(doc.token,0)).clientIds).toEqual([winner,loser]);
  });
  it("returns bounded catch-up versions that can be resumed", async () => {
    const { doc } = await create("");
    await repository!.submit(doc.token, { version: 0, clientId: "batch", steps: Array.from({ length: 1000 }, () => insert("x")) });
    await repository!.submit(doc.token, { version: 1000, clientId: "batch", steps: [insert("y")] });
    const first = await second!.updates(doc.token,0);
    expect(first.steps).toHaveLength(1000); expect(first.version).toBe(1000);
    expect(await second!.updates(doc.token,first.version)).toMatchObject({ version: 1001, clientIds: ["batch"] });
  });
  it("rejects invalid edits atomically and stores server-computed checkpoint content", async () => {
    const { doc } = await create();
    await expect(repository!.submit(doc.token, { version: 0, clientId: "a", steps: [{ stepType: "attr", pos: 0, attr: "language", value: "js" }] })).rejects.toMatchObject({ data: { code: "INVALID_EDITOR_PAYLOAD" } });
    await expect(repository!.submit(doc.token, { version: 0, clientId: "a", steps: [insert("a".repeat(500000))] })).rejects.toMatchObject({ data: { code: "DOCUMENT_TOO_LARGE" } });
    expect((await repository!.open(doc.token))!.version).toBe(0);
    const first = await repository!.checkpoint(doc.token,"Max");
    expect(await second!.checkpoint(doc.token,"Another author")).toEqual(first);
    await repository!.submit(doc.token, { version: 0, clientId: "a", steps: [insert("A")] });
    const newer = await repository!.checkpoint(doc.token,"Max");
    expect(await repository!.compare(doc.token,first._id,newer._id)).toMatchObject({ older: { markdown: "abc", version: 0 }, newer: { markdown: "Aabc", version: 1 } });
    for (let version=1; version<19; version++) {
      await repository!.submit(doc.token,{ version, clientId: "a", steps: [insert("x")] });
      await repository!.checkpoint(doc.token,"Max");
    }
    await repository!.submit(doc.token,{ version:19, clientId:"a", steps:[insert("x")] });
    await expect(repository!.checkpoint(doc.token,"Max")).rejects.toMatchObject({ data:{ code:"CHECKPOINT_LIMIT_REACHED" } });
    expect((await repository!.updates(doc.token,20)).checkpoints).toHaveLength(20);
  });
  it("returns checkpoint character counts without exposing checkpoint source in synchronization", async () => {
    const { doc } = await create("a😀\n");
    const checkpoint = await repository!.checkpoint(doc.token, "Max");
    expect(checkpoint.charCount).toBe(3);
    expect(await second!.checkpoint(doc.token, "Other")).toEqual(checkpoint);
    expect((await repository!.updates(doc.token, 0)).checkpoints).toEqual([checkpoint]);
    await repository!.submit(doc.token, { version: 0, clientId: "a", steps: [insert("next")] });
    const newer = await repository!.checkpoint(doc.token, "Max");
    expect((await repository!.compare(doc.token, checkpoint._id, newer._id)).older.markdown).toBe("a😀\n");
  });
  it("keeps other sessions online after one leaves and tracks disconnection", async () => {
    const { doc } = await create();
    await repository!.touch(doc.token,{sessionId:"one",userId:"max",name:"Max"});
    await second!.touch(doc.token,{sessionId:"two",userId:"max",name:"Max"});
    await repository!.leave(doc.token,"one");
    expect((await repository!.updates(doc.token,0)).presence).toEqual([{userId:"max",name:"Max",online:true,lastDisconnected:0}]);
    await second!.leave(doc.token,"two");
    expect((await repository!.updates(doc.token,0)).presence).toEqual([expect.objectContaining({online:false,lastDisconnected:expect.any(Number)})]);
    await repository!.touch(doc.token,{sessionId:"one",userId:"max",name:"Max"});
    await sql!`UPDATE tools.markdown_presence SET touched_at=${Date.now()-46000} WHERE token=${doc.token}`;
    expect((await repository!.updates(doc.token,0)).presence[0].online).toBe(false);
  });
  it("requires a snapshot reload below imported history and retains native version zero", async () => {
    const { doc } = await create();
    await sql!`UPDATE tools.markdown_documents SET version=17,history_floor=17 WHERE token=${doc.token}`;
    expect((await repository!.open(doc.token))!.version).toBe(17);
    await expect(repository!.updates(doc.token,0)).rejects.toMatchObject({data:{code:"HISTORY_UNAVAILABLE"}});
    await expect(repository!.submit(doc.token,{version:0,clientId:"a",steps:[insert("x")]})).rejects.toMatchObject({data:{code:"HISTORY_UNAVAILABLE"}});
    expect(await repository!.submit(doc.token,{version:17,clientId:"a",steps:[insert("x")]})).toMatchObject({version:18,status:"synced"});
  });
  it("skips locked expiry rows and checks expiry after a blocked write acquires its lock", async () => {
    const { doc } = await create();
    let unlock!: () => void;
    let locked!: () => void;
    const acquired = new Promise<void>(resolve => { locked=resolve; });
    const release = new Promise<void>(resolve => { unlock=resolve; });
    const holder = sql!.begin(async tx => {
      await tx`SELECT token FROM tools.markdown_documents WHERE token=${doc.token} FOR UPDATE`;
      await tx`UPDATE tools.markdown_documents SET expires_at=${Date.now()-1} WHERE token=${doc.token}`;
      locked(); await release;
    });
    await acquired;
    try {
      expect(await repository!.expire(1)).toBe(0);
      const blocked = repository!.submit(doc.token,{version:0,clientId:"a",steps:[insert("x")]});
      unlock(); await holder;
      await expect(blocked).rejects.toMatchObject({data:{code:"DOCUMENT_UNAVAILABLE"}});
    } finally { unlock(); await holder; }
    expect(await repository!.expire(1)).toBe(1);
  });
  it("extends pin retention, does not shorten on unpin, and cascades expiry", async () => {
    const { doc } = await create();
    const pinned = await repository!.setPinned(doc.token,true);
    expect(pinned.expiresAt-doc.updatedAt).toBe(30*86400000);
    expect((await repository!.setPinned(doc.token,false)).expiresAt).toBe(pinned.expiresAt);
    await repository!.checkpoint(doc.token,"Max");
    await sql!`UPDATE tools.markdown_documents SET expires_at=${Date.now()-1} WHERE token=${doc.token}`;
    expect(await second!.open(doc.token)).toBeNull();
    await expect(repository!.submit(doc.token,{version:0,clientId:"a",steps:[insert("x")]})).rejects.toMatchObject({data:{code:"DOCUMENT_UNAVAILABLE"}});
    expect(await repository!.expire(1)).toBe(1);
    expect(await sql!`SELECT id FROM tools.markdown_checkpoints WHERE token=${doc.token}`).toHaveLength(0);
  });
});
