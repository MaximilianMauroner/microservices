import type { Database } from "bun:sqlite";
import postgres,{type Sql,type TransactionSql}from"postgres";
import type { Candidate, DecisionRecord } from "../types.js";
import {normalizeRow,SEQUENCED_TABLES,snapshotReport,snapshotsEqual,sqliteSnapshot,summarize,type LogicalSnapshot,type SequenceState,type SnapshotReport,type TableName}from"./logical-snapshot.js";

const UTC_FORMAT=`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const PROJECTIONS:Record<TableName,string>={
  candidates:`candidate_id,idempotency_key,payload,payload_hash,to_char(created_at AT TIME ZONE 'UTC',${UTC_FORMAT}) created_at`,
  review_rounds:`candidate_id,round,kind,CASE WHEN due_at IS NULL THEN NULL ELSE to_char(due_at AT TIME ZONE 'UTC',${UTC_FORMAT}) END due_at,verdict_id`,
  verdict_events:`sequence::text sequence,decision_id,candidate_id,round,action,reviewer,to_char(reviewed_at AT TIME ZONE 'UTC',${UTC_FORMAT}) reviewed_at,CASE WHEN next_review_at IS NULL THEN NULL ELSE to_char(next_review_at AT TIME ZONE 'UTC',${UTC_FORMAT}) END next_review_at,round_kind,effect,amends_decision_id`,
  application_receipts:`idempotency_key,payload_hash,decision_id,to_char(applied_at AT TIME ZONE 'UTC',${UTC_FORMAT}) applied_at,result`,
  field_guide_schema_migrations:`name,checksum,to_char(applied_at AT TIME ZONE 'UTC',${UTC_FORMAT}) applied_at,adopted`,
  decision_records:`sequence::text sequence,decision_record_id,idempotency_key,payload,payload_hash,to_char(created_at AT TIME ZONE 'UTC',${UTC_FORMAT}) created_at,to_char(received_at AT TIME ZONE 'UTC',${UTC_FORMAT}) received_at`,
  decision_feedback_events:`sequence::text sequence,feedback_id,decision_record_id,action,comment,reviewer,to_char(reviewed_at AT TIME ZONE 'UTC',${UTC_FORMAT}) reviewed_at,amends_feedback_id`,
  decision_promotions:`candidate_id,idempotency_key,payload_hash,to_char(promoted_at AT TIME ZONE 'UTC',${UTC_FORMAT}) promoted_at,promoted_by`,
  decision_promotion_records:`candidate_id,decision_record_id,ordinal`,
};

export async function postgresSnapshot(sql:Sql|TransactionSql):Promise<LogicalSnapshot>{
  const read=async(table:TableName)=>(await sql.unsafe<Record<string,unknown>[]>(`SELECT ${PROJECTIONS[table]} FROM ${table}`)).map(normalizeRow);
  const entries=await Promise.all(SEQUENCED_TABLES.map(async table=>[table,await postgresSequence(sql,table)] as const));
  const sequences=Object.fromEntries(entries) as LogicalSnapshot["sequences"];
  return summarize({candidates:await read("candidates"),review_rounds:await read("review_rounds"),verdict_events:await read("verdict_events"),application_receipts:await read("application_receipts"),field_guide_schema_migrations:await read("field_guide_schema_migrations"),decision_records:await read("decision_records"),decision_feedback_events:await read("decision_feedback_events"),decision_promotions:await read("decision_promotions"),decision_promotion_records:await read("decision_promotion_records")},sequences);
}

async function postgresSequence(sql:Sql|TransactionSql,table:(typeof SEQUENCED_TABLES)[number]):Promise<SequenceState>{const rows=await sql.unsafe<{last_value:string;is_called:boolean}[]>(`SELECT last_value::text last_value,is_called FROM ${table}_sequence_seq`);const row=rows[0];if(!row)throw new Error(`PostgreSQL ${table} sequence state is unavailable.`);return{lastValue:row.last_value,isCalled:row.is_called,nextValue:(BigInt(row.last_value)+(row.is_called?1n:0n)).toString()};}

export function transferSnapshotToSQLite(db:Database,source:LogicalSnapshot,allowOverwrite=false):SnapshotReport{
  validateSequence(source);
  const destination=sqliteSnapshot(db);
  if(total(destination)>0&&snapshotsEqual(source,destination))return snapshotReport(destination);
  if(total(destination)>0&&!allowOverwrite)throw new Error("SQLite destination is nonempty and differs from source; explicit overwrite authorization is required.");
  db.exec("BEGIN IMMEDIATE");
  try{if(total(destination)>0)clearSQLite(db);writeSQLite(db,source);setSQLiteSequences(db,source.sequences);const verified=sqliteSnapshot(db);if(!snapshotsEqual(source,verified))throw new Error("Source to SQLite logical verification failed.");db.exec("COMMIT");return snapshotReport(verified);}catch(error){db.exec("ROLLBACK");throw error;}
}

export async function importPostgresToSQLite(db:Database,url:string,allowOverwrite=false){const client=postgres(url,{max:1,connection:{search_path:"public"}});try{return await client.begin("isolation level repeatable read read only",async tx=>transferSnapshotToSQLite(db,await postgresSnapshot(tx),allowOverwrite));}finally{await client.end();}}

export async function recoverSQLiteToPostgres(db:Database,url:string,allowNonempty=false){const source=sqliteSnapshot(db);validateSequence(source);const client=postgres(url,{max:1,connection:{search_path:"public"}});try{return await client.begin("isolation level serializable",async tx=>{const destination=await postgresSnapshot(tx);if(total(destination)>0&&snapshotsEqual(source,destination))return snapshotReport(destination);if(total(destination)>0&&!allowNonempty)throw new Error("PostgreSQL destination is nonempty; explicit recovery authorization is required.");if(total(destination)>0)await clearPostgres(tx);await writePostgres(tx,source);const verified=await postgresSnapshot(tx);if(!snapshotsEqual(source,verified))throw new Error("SQLite to PostgreSQL logical verification failed.");return snapshotReport(verified);});}finally{await client.end();}}

const total=(snapshot:LogicalSnapshot)=>Object.values(snapshot.counts).reduce((sum,count)=>sum+count,0);
function validateSequence(snapshot:LogicalSnapshot){for(const table of SEQUENCED_TABLES){const max=BigInt(snapshot.maxSequences[table]);const next=BigInt(snapshot.sequences[table].nextValue);if(next<1n||(max>0n&&next<=max))throw new Error(`${table} sequence next value must be greater than every stored sequence.`);}}
function clearSQLite(db:Database){db.exec("DELETE FROM decision_promotion_records; DELETE FROM decision_promotions; DELETE FROM decision_feedback_events; DELETE FROM decision_records; DELETE FROM application_receipts; UPDATE review_rounds SET verdict_id=NULL; DELETE FROM verdict_events; DELETE FROM review_rounds; DELETE FROM candidates; DELETE FROM field_guide_schema_migrations; DELETE FROM sqlite_sequence WHERE name IN ('verdict_events','decision_records','decision_feedback_events')");}
function setSQLiteSequences(db:Database,sequences:LogicalSnapshot["sequences"]){for(const table of SEQUENCED_TABLES){const last=BigInt(sequences[table].nextValue)-1n;db.query("DELETE FROM sqlite_sequence WHERE name=?").run(table);if(last>0n)db.query("INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)").run(table,last);}}
const orderedEvents=(snapshot:LogicalSnapshot)=>[...snapshot.tables.verdict_events].sort((left,right)=>{const leftSequence=BigInt(String(left.sequence));const rightSequence=BigInt(String(right.sequence));return leftSequence<rightSequence?-1:leftSequence>rightSequence?1:0;});
const orderedFeedbackEvents=(snapshot:LogicalSnapshot)=>[...snapshot.tables.decision_feedback_events].sort((left,right)=>{const leftSequence=BigInt(String(left.sequence));const rightSequence=BigInt(String(right.sequence));return leftSequence<rightSequence?-1:leftSequence>rightSequence?1:0;});
function writeSQLite(db:Database,snapshot:LogicalSnapshot){
  for(const row of snapshot.tables.candidates)db.query("INSERT INTO candidates VALUES(?,?,?,?,?)").run(String(row.candidate_id),String(row.idempotency_key),JSON.stringify(row.payload),String(row.payload_hash),String(row.created_at));
  for(const row of snapshot.tables.review_rounds)db.query("INSERT INTO review_rounds(candidate_id,round,kind,due_at,verdict_id) VALUES(?,?,?,?,NULL)").run(String(row.candidate_id),Number(row.round),String(row.kind),nullableString(row.due_at));
  for(const row of orderedEvents(snapshot))db.query("INSERT INTO verdict_events(sequence,decision_id,candidate_id,round,action,reviewer,reviewed_at,next_review_at,round_kind,effect,amends_decision_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(BigInt(String(row.sequence)),String(row.decision_id),String(row.candidate_id),Number(row.round),String(row.action),String(row.reviewer),String(row.reviewed_at),nullableString(row.next_review_at),String(row.round_kind),String(row.effect),nullableString(row.amends_decision_id));
  for(const row of snapshot.tables.review_rounds)if(row.verdict_id)db.query("UPDATE review_rounds SET verdict_id=? WHERE candidate_id=? AND round=?").run(String(row.verdict_id),String(row.candidate_id),Number(row.round));
  for(const row of snapshot.tables.application_receipts)db.query("INSERT INTO application_receipts VALUES(?,?,?,?,?)").run(String(row.idempotency_key),String(row.payload_hash),String(row.decision_id),String(row.applied_at),String(row.result));
  for(const row of snapshot.tables.field_guide_schema_migrations)db.query("INSERT INTO field_guide_schema_migrations VALUES(?,?,?,?)").run(String(row.name),String(row.checksum),String(row.applied_at),row.adopted?1:0);
  for(const row of snapshot.tables.decision_records)db.query("INSERT INTO decision_records(sequence,decision_record_id,idempotency_key,payload,payload_hash,created_at,received_at) VALUES(?,?,?,?,?,?,?)").run(BigInt(String(row.sequence)),String(row.decision_record_id),String(row.idempotency_key),JSON.stringify(row.payload),String(row.payload_hash),String(row.created_at),String(row.received_at));
  for(const row of orderedFeedbackEvents(snapshot))db.query("INSERT INTO decision_feedback_events(sequence,feedback_id,decision_record_id,action,comment,reviewer,reviewed_at,amends_feedback_id) VALUES(?,?,?,?,?,?,?,?)").run(BigInt(String(row.sequence)),String(row.feedback_id),String(row.decision_record_id),String(row.action),nullableString(row.comment),String(row.reviewer),String(row.reviewed_at),nullableString(row.amends_feedback_id));
  for(const row of snapshot.tables.decision_promotions)db.query("INSERT INTO decision_promotions VALUES(?,?,?,?,?)").run(String(row.candidate_id),String(row.idempotency_key),String(row.payload_hash),String(row.promoted_at),String(row.promoted_by));
  for(const row of snapshot.tables.decision_promotion_records)db.query("INSERT INTO decision_promotion_records VALUES(?,?,?)").run(String(row.candidate_id),String(row.decision_record_id),Number(row.ordinal));
}
const nullableString=(value:unknown)=>value===null||value===undefined?null:String(value);
async function clearPostgres(tx:TransactionSql){await tx`DELETE FROM decision_promotion_records`;await tx`DELETE FROM decision_promotions`;await tx`DELETE FROM decision_feedback_events`;await tx`DELETE FROM decision_records`;await tx`DELETE FROM application_receipts`;await tx`UPDATE review_rounds SET verdict_id=NULL`;await tx`DELETE FROM verdict_events`;await tx`DELETE FROM review_rounds`;await tx`DELETE FROM candidates`;await tx`DELETE FROM field_guide_schema_migrations`;}
async function writePostgres(tx:TransactionSql,snapshot:LogicalSnapshot){
  for(const row of snapshot.tables.candidates)await tx`INSERT INTO candidates(candidate_id,idempotency_key,payload,payload_hash,created_at) VALUES(${String(row.candidate_id)},${String(row.idempotency_key)},${tx.json(row.payload as Candidate)},${String(row.payload_hash)},${String(row.created_at)})`;
  for(const row of snapshot.tables.review_rounds)await tx`INSERT INTO review_rounds(candidate_id,round,kind,due_at,verdict_id) VALUES(${String(row.candidate_id)},${Number(row.round)},${String(row.kind)},${nullableString(row.due_at)},NULL)`;
  for(const row of orderedEvents(snapshot))await tx`INSERT INTO verdict_events(sequence,decision_id,candidate_id,round,action,reviewer,reviewed_at,next_review_at,round_kind,effect,amends_decision_id) VALUES(${String(row.sequence)},${String(row.decision_id)},${String(row.candidate_id)},${Number(row.round)},${String(row.action)},${String(row.reviewer)},${String(row.reviewed_at)},${nullableString(row.next_review_at)},${String(row.round_kind)},${String(row.effect)},${nullableString(row.amends_decision_id)})`;
  for(const row of snapshot.tables.review_rounds)if(row.verdict_id)await tx`UPDATE review_rounds SET verdict_id=${String(row.verdict_id)} WHERE candidate_id=${String(row.candidate_id)} AND round=${Number(row.round)}`;
  for(const row of snapshot.tables.application_receipts)await tx`INSERT INTO application_receipts VALUES(${String(row.idempotency_key)},${String(row.payload_hash)},${String(row.decision_id)},${String(row.applied_at)},${String(row.result)})`;
  for(const row of snapshot.tables.field_guide_schema_migrations)await tx`INSERT INTO field_guide_schema_migrations VALUES(${String(row.name)},${String(row.checksum)},${String(row.applied_at)},${Boolean(row.adopted)})`;
  for(const row of snapshot.tables.decision_records)await tx`INSERT INTO decision_records(sequence,decision_record_id,idempotency_key,payload,payload_hash,created_at,received_at) VALUES(${String(row.sequence)},${String(row.decision_record_id)},${String(row.idempotency_key)},${tx.json(row.payload as DecisionRecord)},${String(row.payload_hash)},${String(row.created_at)},${String(row.received_at)})`;
  for(const row of orderedFeedbackEvents(snapshot))await tx`INSERT INTO decision_feedback_events(sequence,feedback_id,decision_record_id,action,comment,reviewer,reviewed_at,amends_feedback_id) VALUES(${String(row.sequence)},${String(row.feedback_id)},${String(row.decision_record_id)},${String(row.action)},${nullableString(row.comment)},${String(row.reviewer)},${String(row.reviewed_at)},${nullableString(row.amends_feedback_id)})`;
  for(const row of snapshot.tables.decision_promotions)await tx`INSERT INTO decision_promotions VALUES(${String(row.candidate_id)},${String(row.idempotency_key)},${String(row.payload_hash)},${String(row.promoted_at)},${String(row.promoted_by)})`;
  for(const row of snapshot.tables.decision_promotion_records)await tx`INSERT INTO decision_promotion_records VALUES(${String(row.candidate_id)},${String(row.decision_record_id)},${Number(row.ordinal)})`;
  for(const table of SEQUENCED_TABLES)await setSequence(tx,table,snapshot.sequences[table].nextValue);
}
async function setSequence(tx:TransactionSql,table:(typeof SEQUENCED_TABLES)[number],nextValue:string){await tx.unsafe(`SELECT setval(pg_get_serial_sequence('${table}','sequence'),$1,false)`,[nextValue]);}
