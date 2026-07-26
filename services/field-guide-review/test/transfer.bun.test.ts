import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSQLite } from "../src/db/sqlite.js";
import { snapshotReport, snapshotsEqual, sqliteSnapshot } from "../src/db/logical-snapshot.js";
import { SQLiteReviewRepository } from "../src/sqlite-repository.js";
const directories:string[]=[];afterEach(()=>{for(const path of directories.splice(0))rmSync(path,{recursive:true,force:true});});
describe("logical transfer snapshots",()=>{
  it("hashes all five tables deterministically and reports max/next sequence",async()=>{const directory=mkdtempSync(join(tmpdir(),"field-guide-transfer-"));directories.push(directory);const handle=openSQLite(join(directory,"source.sqlite"));const repository=new SQLiteReviewRepository(handle.client,handle.close);const candidate={candidateId:"11111111-1111-4111-8111-111111111111",scope:"global" as const,lessonKey:"unicode",title:"Canonical",body:"Nested 会議",rationale:"verification",evidence:[{excerpt:"✅",commitHashes:["abc"]}],createdAt:"2026-07-26T00:00:00.123Z"};await repository.createCandidate("key",candidate);await repository.decide(candidate.candidateId,1,{action:"reject"},new Date(candidate.createdAt),"owner@example.com");handle.client.run("INSERT INTO field_guide_schema_migrations VALUES(?,?,?,?)",["001_baseline","sha256","2026-07-26T00:00:00.123Z",1]);const first=sqliteSnapshot(handle.client);const second=sqliteSnapshot(handle.client);expect(snapshotsEqual(first,second)).toBe(true);expect(snapshotReport(first)).toMatchObject({schema:1,maxSequence:"1",nextSequence:"2",tables:{candidates:{count:1},review_rounds:{count:1},verdict_events:{count:1},application_receipts:{count:0},field_guide_schema_migrations:{count:1}}});await repository.close();});
});
