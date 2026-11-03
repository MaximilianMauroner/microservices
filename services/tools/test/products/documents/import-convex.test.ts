import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { exportDigest, readConvexExport, importDocuments, verifyImportedDocuments } from "../../../products/documents/import-convex.js";
import { sourceSnapshot } from "../../../products/documents/protocol.js";
import { applyMarkdownShareSchema } from "../../../products/documents/schema.js";
const url = process.env.MARKDOWN_SHARE_TEST_DATABASE_URL;
if (url && (!['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname) || !new URL(url).pathname.endsWith('_test'))) throw new Error('Import tests require an owned loopback *_test database.');
it('reconstructs an offline Convex snapshot and refuses missing component history',async()=>{
  const directory = await mkdtemp(join(tmpdir(),'document-export-test-'));
  try {
    const now = Date.now(); const token = randomBytes(32).toString('hex');
    const tables: Record<string,unknown[]> = {
      documents:[{_id:'document-one',token,filename:'legacy.md',createdAt:now-1000,updatedAt:now,expiresAt:now+100000}],
      checkpoints:[{_id:'checkpoint-one',documentId:'document-one',contentId:'content-one',createdAt:now,createdBy:'Legacy',version:1}],
      checkpointContents:[{_id:'content-one',markdown:'abc'}],
      'sync/snapshots':[{id:token,version:1,content:JSON.stringify(sourceSnapshot('abc'))}],
      'sync/deltas':[{id:token,version:2,steps:[JSON.stringify({stepType:'replace',from:1,to:1,slice:{content:[{type:'text',text:'X'}]}})]}],
    };
    for (const [name,rows] of Object.entries(tables)) { await mkdir(join(directory,name),{recursive:true}); await writeFile(join(directory,name,'documents.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')); }
    const documents = await readConvexExport(directory,join(directory,'sync'));
    expect(documents).toMatchObject([{token,source:'Xabc',version:2,pinned:false,format:'markdown',checkpoints:[{source:'abc',version:1}]}]);
    expect(exportDigest(documents)).toBe(exportDigest(documents.map(d=>({...d,checkpoints:[...d.checkpoints].reverse()}))));
    await writeFile(join(directory,'sync/deltas/documents.jsonl'),JSON.stringify({id:token,version:4,steps:[JSON.stringify({stepType:'replace',from:1,to:1,slice:{content:[{type:'text',text:'X'}]}})]}));
    await expect(readConvexExport(directory,join(directory,'sync'))).rejects.toThrow('gap');
  } finally { await rm(directory,{recursive:true,force:true}); }
});
describe.skipIf(!url)('PostgreSQL import safety',()=>{
  it('preserves capabilities and duplicate-version checkpoints, supports retries, and never overwrites changed documents',async()=>{
    const sql = postgres(url!);
    const token = randomBytes(32).toString('hex'); const now=Date.now();
    const documents=[{token,filename:'legacy.md',format:'markdown' as const,pinned:true,createdAt:now-1000,updatedAt:now,expiresAt:now+100000,source:'legacy source',version:7,checkpoints:[
      {id:crypto.randomUUID(),version:2,createdAt:now-500,createdBy:'A',source:'old'},
      {id:crypto.randomUUID(),version:2,createdAt:now-400,createdBy:'B',source:'old'},
    ]}];
    try {
      await applyMarkdownShareSchema(sql, 'admin-subject');
      await importDocuments(sql,documents,'admin-subject'); await importDocuments(sql,documents,'admin-subject');
      await verifyImportedDocuments(sql,documents);
      expect((await sql`SELECT count(*)::int n FROM tools.markdown_checkpoints WHERE token=${token}`)[0].n).toBe(2);
      await expect(importDocuments(sql,[{...documents[0],source:'different'}],'admin-subject')).rejects.toThrow('differs');
      expect((await sql`SELECT source FROM tools.markdown_documents WHERE token=${token}`)[0].source).toBe('legacy source');
      await sql`UPDATE tools.markdown_documents SET source='changed by a live editor' WHERE token=${token}`;
      await expect(importDocuments(sql,documents,'admin-subject')).rejects.toThrow('differs');
    } finally { await sql`DELETE FROM tools.markdown_documents WHERE token=${token}`; await sql.end(); }
  });
});
