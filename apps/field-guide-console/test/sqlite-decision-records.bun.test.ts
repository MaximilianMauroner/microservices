import crypto from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { openSQLite } from "../src/db/sqlite.js";
import { SQLiteReviewRepository } from "../src/sqlite-repository.js";

const directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});
function setup(){const directory=mkdtempSync(join(tmpdir(),"decision-records-sqlite-"));directories.push(directory);const handle=openSQLite(join(directory,"review.sqlite"));return{handle,repository:new SQLiteReviewRepository(handle.client,handle.close)};}
const now=new Date("2026-08-02T12:00:00.000Z");
function record(id=crypto.randomUUID()){return{schemaVersion:1 as const,decisionRecordId:id,taskId:"task-1",scope:"project" as const,projectKey:"repo",projectDisplayName:"Repo",summary:"Choose the safe boundary",context:"Two owners share this target.",options:[{label:"Replace all",rejectedBecause:"Crosses ownership"},{label:"Replace owned entries"}],choice:"Replace owned entries",rationale:"Preserves unrelated content.",consequences:[],confidence:"high" as const,evidence:[{excerpt:"bounded",commitHashes:["abc"]}],createdAt:"2026-08-02T11:00:00.000Z"};}
function candidate(id=crypto.randomUUID()){return{candidateId:id,scope:"project" as const,projectKey:"repo",projectDisplayName:"Repo",lessonKey:"ownership",title:"Preserve ownership boundaries",body:"Replace only owned entries.",rationale:"Separate systems own the target.",evidence:[{excerpt:"source decision",commitHashes:["abc"]}],createdAt:now.toISOString()};}

describe("SQLite decision records",()=>{
  it("persists idempotent records, append-only feedback, filters, and inactive promotion",async()=>{const{handle,repository}=setup();const value=record();expect(await repository.createDecisionRecord("key",value)).toBe("created");expect(await repository.createDecisionRecord("key",value)).toBe("replay");const pending=await repository.decisionRecords({limit:50,reviewState:"unreviewed",includeArchived:false,archiveAfterDays:90,now});expect(pending).toMatchObject({pending:1,items:[{record:{decisionRecordId:value.decisionRecordId}}]});const first=await repository.addDecisionFeedback(value.decisionRecordId,{action:"up",comment:"Contextually sound"},now,"max@example.com");const second=await repository.addDecisionFeedback(value.decisionRecordId,{action:"down",expectedFeedbackId:first.feedbackId},new Date(now.getTime()+1000),"max@example.com");const detail=await repository.decisionRecord(value.decisionRecordId,now);expect(detail.feedbackHistory).toHaveLength(2);expect(detail.currentFeedback?.feedbackId).toBe(second.feedbackId);const draft=candidate();expect((await repository.promoteDecisionRecords("promotion",[value.decisionRecordId],draft,now,"max@example.com")).status).toBe("created");expect((await repository.promoteDecisionRecords("promotion",[value.decisionRecordId],draft,now,"max@example.com")).status).toBe("replay");expect((await repository.queue("project",now))[0]?.candidate.candidateId).toBe(draft.candidateId);expect(handle.client.query("PRAGMA foreign_key_check").all()).toEqual([]);await repository.close();});
});
