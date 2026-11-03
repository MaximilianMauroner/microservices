import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMarkdownShareRepository } from "../../../products/documents/repository.js";
import { applyMarkdownShareSchema } from "../../../products/documents/schema.js";
import { createDocumentChanges } from "../../../products/documents/changes.js";
import { createShareHandler } from "../../../products/documents/http.js";
import type { PublicDocument, SyncUpdate } from "../../../products/documents/types.js";

const url = process.env.MARKDOWN_SHARE_TEST_DATABASE_URL;
if (url && (!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname) || !new URL(url).pathname.endsWith('_test'))) throw new Error('HTTP tests require an owned loopback *_test database.');
describe.skipIf(!url)("Document Share over HTTP", () => {
  let origin: string;
  let server: Server;
  const repository = url ? createMarkdownShareRepository(url) : undefined;
  const changes = url ? createDocumentChanges(url) : undefined;
  const sql = url ? postgres(url) : undefined;
  const tokens: string[] = [];
  async function post(path: string, body: unknown, requestOrigin = origin) {
    return fetch(`${origin}/api/share/documents${path}`, { method: 'POST', headers: { Origin: requestOrigin, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
  }
  beforeAll(async () => {
    await applyMarkdownShareSchema(sql!, "admin-subject");
    server = createServer(async (incoming, outgoing) => {
      const abort = new AbortController();
      outgoing.on('close', () => abort.abort());
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const request = new Request(`${origin}${incoming.url}`, { method: incoming.method, headers: incoming.headers as Record<string,string>, signal: abort.signal,
        ...(incoming.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
      const response = await createShareHandler(repository!, changes!, origin, async () => 'admin-subject')(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test listener.');
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await changes!.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (tokens.length) await sql!`DELETE FROM tools.markdown_documents WHERE token IN ${sql!(tokens)}`;
    await Promise.all([repository!.close(),sql!.end()]);
  });
  it('creates anonymously, loads initial history immediately, and wakes a different poll after a save', async () => {
    const response = await post('',{ requestId: randomUUID(), filename:'shared.tex',format:'latex',markdown:'abc' });
    expect(response.status).toBe(200);
    const document = await response.json() as PublicDocument;
    tokens.push(document.token);
    const path = `/${document.token}`;
    const snapshot = await (await fetch(`${origin}/api/share/documents${path}`)).json();
    expect(snapshot).toMatchObject({ document: { format:'latex' },version:0 });
    const first = await fetch(`${origin}/api/share/documents${path}/updates?version=0&wait=0`);
    expect((await first.json()).checkpoints).toEqual([]);
    const poll = fetch(`${origin}/api/share/documents${path}/updates?version=0`);
    const result = await post(`${path}/steps`,{ version:0,clientId:'editor-one',steps:[{stepType:'replace',from:1,to:1,slice:{content:[{type:'text',text:'A'}]}}] });
    expect(result.status).toBe(200);
    const update = await (await poll).json() as SyncUpdate;
    expect(update).toMatchObject({ version:1,clientIds:['editor-one'] });
    expect(update.steps).toHaveLength(1);
    const retry = await post(`${path}/steps`,{version:0,clientId:'editor-one',steps:[{stepType:'replace',from:1,to:1,slice:{content:[{type:'text',text:'A'}]}}]});
    expect(await retry.json()).toMatchObject({status:'rebase',version:1});
    const checkpoint = await (await post(`${path}/checkpoints`,{createdBy:'One'})).json();
    expect(checkpoint).toMatchObject({version:1,charCount:4});
    const meta = await (await fetch(`${origin}/api/share/documents${path}/updates?version=1&wait=0`)).json();
    expect(meta.checkpoints).toHaveLength(1);
    expect((await post(`${path}/pin`,{pinned:true})).status).toBe(200);
  });
  it('rejects cross-origin changes, malformed input, and unavailable capabilities without exposing content', async () => {
    expect((await post('',{},'https://attacker.example')).status).toBe(403);
    expect((await post('',{})).status).toBe(400);
    const response = await fetch(`${origin}/api/share/documents/${'a'.repeat(64)}/updates?version=0`);
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
