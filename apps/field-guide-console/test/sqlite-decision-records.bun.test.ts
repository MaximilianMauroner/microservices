import crypto from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { openSQLite } from "../src/db/sqlite.js";
import { SQLiteReviewRepository } from "../src/sqlite-repository.js";
import { sqliteSnapshot } from "../src/db/logical-snapshot.js";
import { transferSnapshotToSQLite } from "../src/db/transfer.js";
import { prepareSQLiteTestDatabase } from "./sqlite-push-fixture.js";

const directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});
function setup(){const directory=mkdtempSync(join(tmpdir(),"decision-records-sqlite-"));directories.push(directory);const path=join(directory,"review.sqlite");prepareSQLiteTestDatabase(path);const handle=openSQLite(path);return{handle,repository:new SQLiteReviewRepository(handle.client,handle.close)};}
const now=new Date("2026-08-02T12:00:00.000Z");
function record(id:string=crypto.randomUUID()){return{schemaVersion:1 as const,decisionRecordId:id,taskId:"task-1",scope:"project" as const,projectKey:"repo",projectDisplayName:"Repo",summary:"Choose the safe boundary",context:"Two owners share this target.",options:[{label:"Replace all",rejectedBecause:"Crosses ownership"},{label:"Replace owned entries"}],choice:"Replace owned entries",rationale:"Preserves unrelated content.",consequences:[],confidence:"high" as const,evidence:[{excerpt:"bounded",commitHashes:["abc"]}],createdAt:"2026-08-02T11:00:00.000Z"};}
function candidate(id:string=crypto.randomUUID()){return{candidateId:id,scope:"project" as const,projectKey:"repo",projectDisplayName:"Repo",lessonKey:"ownership",title:"Preserve ownership boundaries",body:"Replace only owned entries.",rationale:"Separate systems own the target.",evidence:[{excerpt:"source decision",commitHashes:["abc"]}],createdAt:now.toISOString()};}

describe("SQLite decision records",()=>{
  it("persists idempotent records, append-only feedback, filters, and inactive promotion",async()=>{const{handle,repository}=setup();const value=record();expect(await repository.createDecisionRecord("key",value)).toBe("created");expect(await repository.createDecisionRecord("key",value)).toBe("replay");const pending=await repository.decisionRecords({limit:50,reviewState:"unreviewed",includeArchived:false,archiveAfterDays:90,now});expect(pending).toMatchObject({pending:1,items:[{record:{decisionRecordId:value.decisionRecordId}}]});const first=await repository.addDecisionFeedback(value.decisionRecordId,{action:"up",comment:"Contextually sound"},now,"max@example.com");const second=await repository.addDecisionFeedback(value.decisionRecordId,{action:"down",expectedFeedbackId:first.feedbackId},new Date(now.getTime()+1000),"max@example.com");const detail=await repository.decisionRecord(value.decisionRecordId,now,90);expect(detail.feedbackHistory).toHaveLength(2);expect(detail.currentFeedback?.feedbackId).toBe(second.feedbackId);const draft=candidate();expect((await repository.promoteDecisionRecords("promotion",[value.decisionRecordId],draft,now,"max@example.com")).status).toBe("created");expect((await repository.promoteDecisionRecords("promotion",[value.decisionRecordId],draft,now,"max@example.com")).status).toBe("replay");expect((await repository.queue("project",now))[0]?.candidate.candidateId).toBe(draft.candidateId);expect(handle.client.query("PRAGMA foreign_key_check").all()).toEqual([]);await repository.close();});

  it("uses configured archive retention and the feedback access index",async()=>{
    const{handle,repository}=setup();const value=record();await repository.createDecisionRecord("archive",value);
    await repository.addDecisionFeedback(value.decisionRecordId,{action:"up"},new Date(now.getTime()-45*86_400_000),"max@example.com");
    const filters={limit:50,reviewState:"reviewed" as const,includeArchived:false,archiveAfterDays:30,now};
    expect((await repository.decisionRecords(filters)).items).toEqual([]);
    const archived=await repository.decisionRecords({...filters,includeArchived:true});
    expect(archived.items[0]?.archived).toBe(true);
    expect((await repository.decisionRecord(value.decisionRecordId,now,30)).archived).toBe(true);
    const plan=handle.client.query<{detail:string},[string]>("EXPLAIN QUERY PLAN SELECT feedback_id FROM decision_feedback_events WHERE decision_record_id=? ORDER BY sequence DESC LIMIT 1").all(value.decisionRecordId);
    expect(plan.some((row)=>row.detail.includes("decision_feedback_events_record_sequence_idx"))).toBe(true);
    await repository.close();
  });

  it("filters global records by their source project",async()=>{
    const{repository}=setup();const value={...record(),scope:"global" as const,projectKey:undefined,projectDisplayName:undefined,foundProjectKey:"org/global-source",foundProjectDisplayName:"global-source"};
    await repository.createDecisionRecord("global-source",value);
    const page=await repository.decisionRecords({limit:50,reviewState:"all",projectKey:"org/global-source",includeArchived:false,archiveAfterDays:90,now});
    expect(page.items.map((item)=>item.record.decisionRecordId)).toEqual([value.decisionRecordId]);
    await repository.close();
  });

  it("canonicalizes direct mixed-case UUIDs and preserves them through restore",async()=>{
    const source=setup(),lowercaseId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",uppercaseId=lowercaseId.toUpperCase(),value=record(uppercaseId);await source.repository.createDecisionRecord("mixed-case",value);expect((await source.repository.decisionRecord(lowercaseId,now,90)).record.decisionRecordId).toBe(lowercaseId);expect((await source.repository.decisionRecord(uppercaseId,now,90)).record.decisionRecordId).toBe(lowercaseId);const feedback=await source.repository.addDecisionFeedback(uppercaseId,{action:"up"},now,"max@example.com");const amended=await source.repository.addDecisionFeedback(lowercaseId,{action:"down",expectedFeedbackId:feedback.feedbackId.toUpperCase()},new Date(now.getTime()+1),"max@example.com");expect(amended.decisionRecordId).toBe(lowercaseId);const candidateId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",promotion=await source.repository.promoteDecisionRecords("mixed-promotion",[uppercaseId],{...candidate(candidateId.toUpperCase()),candidateId:candidateId.toUpperCase()},now,"max@example.com");expect(promotion.promotion).toMatchObject({candidateId,decisionRecordIds:[lowercaseId]});
    const snapshot=sqliteSnapshot(source.handle.client);expect(snapshot.tables.decision_records[0]).toMatchObject({decision_record_id:lowercaseId,payload:{decisionRecordId:lowercaseId}});const target=setup();transferSnapshotToSQLite(target.handle.client,snapshot);expect((await target.repository.decisionRecord(uppercaseId,now,90)).record.decisionRecordId).toBe(lowercaseId);await source.repository.close();await target.repository.close();
  });
});
