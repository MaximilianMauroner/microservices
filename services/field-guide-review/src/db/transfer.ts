import type { Database } from "bun:sqlite";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { normalizeRow, snapshotReport, snapshotsEqual, sqliteSnapshot, summarize, type LogicalSnapshot, type TableName } from "./logical-snapshot.js";
import type { Candidate } from "../types.js";

export async function postgresSnapshot(sql:Sql|TransactionSql):Promise<LogicalSnapshot> {
  const read=async(table:TableName,order:string)=>(await sql.unsafe<Record<string,unknown>[]>(`SELECT * FROM ${table} ORDER BY ${order}`)).map(normalizeRow);
  return summarize({candidates:await read("candidates","candidate_id"),review_rounds:await read("review_rounds","candidate_id,round"),verdict_events:await read("verdict_events","sequence"),application_receipts:await read("application_receipts","idempotency_key"),field_guide_schema_migrations:await read("field_guide_schema_migrations","name")});
}

export async function importPostgresToSQLite(db:Database,url:string,allowOverwrite=false) {
  const client=postgres(url,{max:1,connection:{search_path:"public"}});
  try{return await client.begin("isolation level repeatable read read only",async tx=>{
    const source=await postgresSnapshot(tx);
    const destination=sqliteSnapshot(db);
    if(total(destination)>0&&snapshotsEqual(source,destination))return snapshotReport(destination);
    if(total(destination)>0&&!allowOverwrite)throw new Error("SQLite destination is nonempty and differs from PostgreSQL; explicit overwrite authorization is required.");
    db.exec("BEGIN IMMEDIATE");
    try { if(total(destination)>0)clearSQLite(db); writeSQLite(db,source); const verified=sqliteSnapshot(db); if(!snapshotsEqual(source,verified))throw new Error("PostgreSQL to SQLite logical verification failed."); db.exec("COMMIT"); return snapshotReport(verified); }
    catch(error){db.exec("ROLLBACK");throw error;}
  });}finally{await client.end();}
}

export async function recoverSQLiteToPostgres(db:Database,url:string,allowNonempty=false) {
  const source=sqliteSnapshot(db); const client=postgres(url,{max:1,connection:{search_path:"public"}});
  try{return await client.begin("isolation level serializable",async tx=>{
    const destination=await postgresSnapshot(tx);
    if(total(destination)>0&&snapshotsEqual(source,destination))return snapshotReport(destination);
    if(total(destination)>0&&!allowNonempty)throw new Error("PostgreSQL destination is nonempty; explicit recovery authorization is required.");
    if(total(destination)>0)await clearPostgres(tx);
    await writePostgres(tx,source);
    const verified=await postgresSnapshot(tx); if(!snapshotsEqual(source,verified))throw new Error("SQLite to PostgreSQL logical verification failed."); return snapshotReport(verified);
  });}finally{await client.end();}
}

const total=(snapshot:LogicalSnapshot)=>Object.values(snapshot.counts).reduce((sum,count)=>sum+count,0);
function clearSQLite(db:Database){db.exec("DELETE FROM application_receipts; UPDATE review_rounds SET verdict_id=NULL; DELETE FROM verdict_events; DELETE FROM review_rounds; DELETE FROM candidates; DELETE FROM field_guide_schema_migrations; DELETE FROM sqlite_sequence WHERE name='verdict_events'");}
function writeSQLite(db:Database,s:LogicalSnapshot){
  for(const r of s.tables.candidates)db.query("INSERT INTO candidates VALUES(?,?,?,?,?)").run(String(r.candidate_id),String(r.idempotency_key),JSON.stringify(r.payload),String(r.payload_hash),String(r.created_at));
  for(const r of s.tables.review_rounds)db.query("INSERT INTO review_rounds(candidate_id,round,kind,due_at,verdict_id) VALUES(?,?,?,?,NULL)").run(String(r.candidate_id),Number(r.round),String(r.kind),nullableString(r.due_at));
  for(const r of s.tables.verdict_events)db.query("INSERT INTO verdict_events(sequence,decision_id,candidate_id,round,action,reviewer,reviewed_at,next_review_at,round_kind,effect,amends_decision_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(BigInt(String(r.sequence)),String(r.decision_id),String(r.candidate_id),Number(r.round),String(r.action),String(r.reviewer),String(r.reviewed_at),nullableString(r.next_review_at),String(r.round_kind),String(r.effect),nullableString(r.amends_decision_id));
  for(const r of s.tables.review_rounds)if(r.verdict_id)db.query("UPDATE review_rounds SET verdict_id=? WHERE candidate_id=? AND round=?").run(String(r.verdict_id),String(r.candidate_id),Number(r.round));
  for(const r of s.tables.application_receipts)db.query("INSERT INTO application_receipts VALUES(?,?,?,?,?)").run(String(r.idempotency_key),String(r.payload_hash),String(r.decision_id),String(r.applied_at),String(r.result));
  for(const r of s.tables.field_guide_schema_migrations)db.query("INSERT INTO field_guide_schema_migrations VALUES(?,?,?,?)").run(String(r.name),String(r.checksum),String(r.applied_at),r.adopted?1:0);
}
const nullableString=(value:unknown)=>value===null||value===undefined?null:String(value);
async function clearPostgres(tx:TransactionSql){await tx`DELETE FROM application_receipts`;await tx`UPDATE review_rounds SET verdict_id=NULL`;await tx`DELETE FROM verdict_events`;await tx`DELETE FROM review_rounds`;await tx`DELETE FROM candidates`;await tx`DELETE FROM field_guide_schema_migrations`;}
async function writePostgres(tx:TransactionSql,s:LogicalSnapshot){
  for(const r of s.tables.candidates)await tx`INSERT INTO candidates(candidate_id,idempotency_key,payload,payload_hash,created_at) VALUES(${String(r.candidate_id)},${String(r.idempotency_key)},${tx.json(r.payload as Candidate)},${String(r.payload_hash)},${String(r.created_at)})`;
  for(const r of s.tables.review_rounds)await tx`INSERT INTO review_rounds(candidate_id,round,kind,due_at,verdict_id) VALUES(${String(r.candidate_id)},${Number(r.round)},${String(r.kind)},${r.due_at?String(r.due_at):null},NULL)`;
  for(const r of s.tables.verdict_events)await tx`INSERT INTO verdict_events(sequence,decision_id,candidate_id,round,action,reviewer,reviewed_at,next_review_at,round_kind,effect,amends_decision_id) VALUES(${String(r.sequence)},${String(r.decision_id)},${String(r.candidate_id)},${Number(r.round)},${String(r.action)},${String(r.reviewer)},${String(r.reviewed_at)},${r.next_review_at?String(r.next_review_at):null},${String(r.round_kind)},${String(r.effect)},${r.amends_decision_id?String(r.amends_decision_id):null})`;
  for(const r of s.tables.review_rounds)if(r.verdict_id)await tx`UPDATE review_rounds SET verdict_id=${String(r.verdict_id)} WHERE candidate_id=${String(r.candidate_id)} AND round=${Number(r.round)}`;
  for(const r of s.tables.application_receipts)await tx`INSERT INTO application_receipts VALUES(${String(r.idempotency_key)},${String(r.payload_hash)},${String(r.decision_id)},${String(r.applied_at)},${String(r.result)})`;
  for(const r of s.tables.field_guide_schema_migrations)await tx`INSERT INTO field_guide_schema_migrations VALUES(${String(r.name)},${String(r.checksum)},${String(r.applied_at)},${Boolean(r.adopted)})`;
  await tx`SELECT setval(pg_get_serial_sequence('verdict_events','sequence'),${s.maxSequence==="0"?"1":s.maxSequence},${s.maxSequence!=="0"})`;
}
