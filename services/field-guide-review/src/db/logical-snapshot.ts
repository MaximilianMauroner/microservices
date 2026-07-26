import crypto from "node:crypto";
import type { Database } from "bun:sqlite";

export const TABLES = ["candidates", "review_rounds", "verdict_events", "application_receipts", "field_guide_schema_migrations"] as const;
export type TableName = (typeof TABLES)[number];
export type LogicalSnapshot = { tables: Record<TableName, readonly Record<string, unknown>[]>; counts:Record<TableName,number>; hashes:Record<TableName,string>; maxSequence:string; nextSequence:string };

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function hashRows(rows: readonly Record<string,unknown>[]) { return crypto.createHash("sha256").update(rows.map(canonicalJson).join("\n")).digest("hex"); }
export function summarize(tables:LogicalSnapshot["tables"]):LogicalSnapshot { const counts=Object.fromEntries(TABLES.map(name=>[name,tables[name].length])) as Record<TableName,number>; const hashes=Object.fromEntries(TABLES.map(name=>[name,hashRows(tables[name])])) as Record<TableName,string>; const max=String(tables.verdict_events.at(-1)?.sequence??"0"); return {tables,counts,hashes,maxSequence:max,nextSequence:(BigInt(max)+1n).toString()}; }
export function sqliteSnapshot(db:Database):LogicalSnapshot {
  const read=(table:TableName,order:string)=>db.query<Record<string,unknown>,[]>(`SELECT * FROM ${table} ORDER BY ${order}`).all().map(normalizeRow);
  const verdictEvents=db.query<Record<string,unknown>,[]>("SELECT CAST(sequence AS TEXT) sequence,decision_id,candidate_id,round,action,reviewer,reviewed_at,next_review_at,round_kind,effect,amends_decision_id FROM verdict_events ORDER BY sequence").all().map(normalizeRow);
  return summarize({candidates:read("candidates","candidate_id"),review_rounds:read("review_rounds","candidate_id,round"),verdict_events:verdictEvents,application_receipts:read("application_receipts","idempotency_key"),field_guide_schema_migrations:read("field_guide_schema_migrations","name")});
}
export function normalizeRow(row:Record<string,unknown>):Record<string,unknown> { return Object.fromEntries(Object.entries(row).map(([key,value])=>[key, normalizeValue(key,value)])); }
function normalizeValue(key:string,value:unknown):unknown {
  if(value instanceof Date)return value.toISOString();
  if(key==="payload")return typeof value==="string"?JSON.parse(value) as unknown:value;
  if(key==="sequence")return String(value);
  if(key==="adopted")return typeof value==="boolean"?value:Number(value)===1;
  return value;
}
export function snapshotReport(snapshot:LogicalSnapshot) { return {schema:1,tables:Object.fromEntries(TABLES.map(name=>[name,{count:snapshot.counts[name],hash:snapshot.hashes[name]}])),maxSequence:snapshot.maxSequence,nextSequence:snapshot.nextSequence}; }
export function snapshotsEqual(left:LogicalSnapshot,right:LogicalSnapshot) { return TABLES.every(name=>left.counts[name]===right.counts[name]&&left.hashes[name]===right.hashes[name])&&left.maxSequence===right.maxSequence; }
