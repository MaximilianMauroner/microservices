import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres, { type Sql, type TransactionSql } from "postgres";
import {
  ConflictError,
  ValidationError,
  decodeCursor,
  encodeCursor,
  validateVerdict,
  type AmendVerdictInput,
  type Candidate,
  type Decision,
  type Effect,
  type QueueItem,
  type ReviewRepository,
  type RoundKind,
  type Scope,
  type Summary,
  type VerdictInput,
} from "./types.js";
type CandidateRow = { payload: Candidate; payload_hash: string };
type Migration = { name: string; checksum: string; sql: string };
type BaselineColumn = {
  tableName: string;
  columnName: string;
  dataType: string;
  notNull: boolean;
};
type BaselineConstraint = {
  name: string;
  type: "c" | "f" | "p" | "u";
  columns: string[];
  referencedTable?: string;
  referencedSchema?: string;
  referencedColumns?: string[];
  checkValues?: string[];
  definition?: string;
  deferrable?: boolean;
  initiallyDeferred?: boolean;
  foreignDeleteAction?: string;
  foreignUpdateAction?: string;
  foreignMatchType?: string;
};
type EventRow = {
  sequence: string;
  decision_id: string;
  candidate_id: string;
  round: number;
  action: Decision["action"];
  round_kind: RoundKind;
  effect: Effect;
  amends_decision_id: string | null;
  is_current: boolean;
  can_amend: boolean;
  reviewed_at: Date;
  next_review_at: Date | null;
  reviewer: string;
  payload: Candidate;
};
export class PostgresReviewRepository implements ReviewRepository {
  private readonly sql: Sql;
  constructor(url: string) {
    this.sql = postgres(url, {
      max: 5,
      connection: { search_path: FIELD_GUIDE_SCHEMA },
    });
  }
  async migrate() {
    const migrations: Migration[] = [];
    for (const name of ["001_initial.sql", "002_decision_amendments.sql"]) {
      const path = fileURLToPath(
        new URL(`../migrations/${name}`, import.meta.url),
      );
      const sql = await readFile(path, "utf8");
      if (containsTransactionControl(sql))
        throw new Error(`${name} must not contain transaction control.`);
      migrations.push({ name, sql, checksum: digestText(sql) });
    }
    await this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`;
      const namespace = await tx<{ schema: string | null }[]>`
        SELECT to_regnamespace(${FIELD_GUIDE_SCHEMA})::text schema
      `;
      if (namespace[0]?.schema !== FIELD_GUIDE_SCHEMA)
        throw new Error("The public schema is unavailable for field-guide migrations.");
      await tx.unsafe(`SET LOCAL search_path TO ${FIELD_GUIDE_SCHEMA}, pg_catalog`);
      const ledger = await tx<{ ledger: string | null }[]>`
        SELECT to_regclass('public.field_guide_schema_migrations')::text ledger
      `;
      if (!ledger[0]?.ledger)
        await tx.unsafe(`CREATE TABLE public.field_guide_schema_migrations (
          name text PRIMARY KEY,
          checksum text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now(),
          adopted boolean NOT NULL DEFAULT false
        )`);

      const recorded = await tx<
        { name: string; checksum: string }[]
      >`SELECT name,checksum FROM public.field_guide_schema_migrations`;
      const applied = new Map(recorded.map((row) => [row.name, row.checksum]));
      for (const migration of migrations) {
        const checksum = applied.get(migration.name);
        if (checksum) {
          if (checksum !== migration.checksum)
            throw new Error(
              `Applied migration ${migration.name} has a different checksum.`,
            );
          continue;
        }

        let adopted = false;
        if (migration.name === "001_initial.sql") {
          const baseline = await tx<
            { present: number }[]
          >`SELECT COUNT(*)::int present FROM (VALUES ('public.candidates'),('public.review_rounds'),('public.verdict_events'),('public.application_receipts')) expected(name) WHERE to_regclass(expected.name) IS NOT NULL`;
          const present = baseline[0]?.present ?? 0;
          if (present !== 0 && present !== 4)
            throw new Error(
              "Cannot adopt a partially initialized field-guide schema.",
            );
          if (present === 4) {
            const columns = await tx<BaselineColumn[]>`
              SELECT relation.relname "tableName",attribute.attname "columnName",
                format_type(attribute.atttypid,attribute.atttypmod) "dataType",
                attribute.attnotnull "notNull"
              FROM pg_class relation
              JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
              JOIN pg_attribute attribute ON attribute.attrelid=relation.oid
              WHERE namespace.nspname=${FIELD_GUIDE_SCHEMA}
                AND relation.relname IN ('candidates','review_rounds','verdict_events','application_receipts')
                AND attribute.attnum>0 AND NOT attribute.attisdropped
            `;
            validateBaselineColumns(columns);
            const constraints = await tx<{
              name:string;
              type:BaselineConstraint["type"];
              columns:string[];
              referenced_table:string|null;
              referenced_schema:string|null;
              referenced_columns:string[];
              definition:string;
              deferrable:boolean;
              initially_deferred:boolean;
              foreign_delete_action:string;
              foreign_update_action:string;
              foreign_match_type:string;
            }[]>`
              SELECT constraint.conname name,constraint.contype type,
                ARRAY(SELECT attribute.attname FROM unnest(constraint.conkey) WITH ORDINALITY key(attnum,position) JOIN pg_attribute attribute ON attribute.attrelid=constraint.conrelid AND attribute.attnum=key.attnum ORDER BY key.position) columns,
                referenced.relname referenced_table,
                referenced_namespace.nspname referenced_schema,
                ARRAY(SELECT attribute.attname FROM unnest(constraint.confkey) WITH ORDINALITY key(attnum,position) JOIN pg_attribute attribute ON attribute.attrelid=constraint.confrelid AND attribute.attnum=key.attnum ORDER BY key.position) referenced_columns,
                pg_get_constraintdef(constraint.oid) definition,
                constraint.condeferrable deferrable,
                constraint.condeferred initially_deferred,
                constraint.confdeltype foreign_delete_action,
                constraint.confupdtype foreign_update_action,
                constraint.confmatchtype foreign_match_type
              FROM pg_constraint constraint
              JOIN pg_namespace namespace ON namespace.oid=constraint.connamespace
              LEFT JOIN pg_class referenced ON referenced.oid=constraint.confrelid
              LEFT JOIN pg_namespace referenced_namespace ON referenced_namespace.oid=referenced.relnamespace
              WHERE namespace.nspname=${FIELD_GUIDE_SCHEMA}
            `;
            validateBaselineConstraints(constraints.map((constraint)=>({
              name:constraint.name,
              type:constraint.type,
              columns:constraint.columns,
              ...(constraint.referenced_table?{referencedTable:constraint.referenced_table}:{}),
              ...(constraint.referenced_schema?{referencedSchema:constraint.referenced_schema}:{}),
              ...(constraint.referenced_columns.length?{referencedColumns:constraint.referenced_columns}:{}),
              ...(constraint.type==="c"?{definition:constraint.definition}:{}),
              deferrable:constraint.deferrable,
              initiallyDeferred:constraint.initially_deferred,
              ...(constraint.type==="f"?{foreignDeleteAction:constraint.foreign_delete_action,foreignUpdateAction:constraint.foreign_update_action,foreignMatchType:constraint.foreign_match_type}:{}),
            })));
          }
          adopted = present === 4;
        }
        if (!adopted) await tx.unsafe(migration.sql);
        await tx`INSERT INTO public.field_guide_schema_migrations(name,checksum,adopted) VALUES(${migration.name},${migration.checksum},${adopted})`;
      }
    });
  }
  async createCandidate(key: string, candidate: Candidate) {
    const hash = digest(candidate);
    return this.sql.begin(async (tx) => {
      const old = await tx<
        CandidateRow[]
      >`SELECT payload,payload_hash FROM candidates WHERE idempotency_key=${key}`;
      if (old[0]) {
        if (old[0].payload_hash !== hash)
          throw new ConflictError(
            "Idempotency key already has different content.",
          );
        return "replay" as const;
      }
      try {
        const inserted=await tx<{candidate_id:string}[]>`INSERT INTO candidates(candidate_id,idempotency_key,payload,payload_hash,created_at) VALUES(${candidate.candidateId},${key},${tx.json(candidate)},${hash},${candidate.createdAt}) ON CONFLICT DO NOTHING RETURNING candidate_id`;
        if(!inserted[0]){const raced=await tx<CandidateRow[]>`SELECT payload,payload_hash FROM candidates WHERE idempotency_key=${key}`;if(raced[0]?.payload_hash===hash)return "replay" as const;throw new ConflictError("Candidate already exists.");}
        await tx`INSERT INTO review_rounds(candidate_id,round,kind) VALUES(${candidate.candidateId},1,'initial')`;
        return "created" as const;
      } catch (error) {
        if (isUnique(error)) throw new ConflictError("Candidate already exists.");
        throw error;
      }
    });
  }
  async createReceipt(
    key: string,
    decisionId: string,
    appliedAt: string,
    result: "applied" | "already_applied",
  ) {
    const hash = digest({ decisionId, appliedAt, result });
    const old = await this.sql<
      { payload_hash: string }[]
    >`SELECT payload_hash FROM application_receipts WHERE idempotency_key=${key}`;
    if (old[0]) {
      if (old[0].payload_hash !== hash)
        throw new ConflictError(
          "Idempotency key already has different content.",
        );
      return "replay";
    }
    try {
      const inserted=await this.sql<{idempotency_key:string}[]>`INSERT INTO application_receipts VALUES(${key},${hash},${decisionId},${appliedAt},${result}) ON CONFLICT DO NOTHING RETURNING idempotency_key`;
      if(inserted[0])return "created";
      const raced=await this.sql<{payload_hash:string}[]>`SELECT payload_hash FROM application_receipts WHERE idempotency_key=${key}`;if(raced[0]?.payload_hash===hash)return "replay";throw new ConflictError("Receipt conflict.");
    } catch (error) {
      if (isUnique(error)) throw new ConflictError("Receipt conflict.");
      throw error;
    }
  }
  async decisions(cursor: string | undefined, limit: number, scope?: Scope) {
    const after = decodeCursor(cursor) ?? "0";
    const rows = await this.sql<
      EventRow[]
    >`${eventProjection(this.sql, scope)} AND v.sequence>${after} ORDER BY v.sequence ASC LIMIT ${limit}`;
    const page = rows.slice(0, limit);
    return {
      decisions: page.map(toDecision),
      ...(page.length
        ? { nextCursor: encodeCursor(page.at(-1)?.sequence ?? after) }
        : {}),
    };
  }
  async history(cursor:string|undefined,limit:number,scope?:Scope){const before=decodeCursor(cursor);const rows=await this.sql<EventRow[]>`${eventProjection(this.sql,scope)} AND (${before??null}::bigint IS NULL OR v.sequence<${before??null}) ORDER BY v.sequence DESC LIMIT ${limit+1}`;const page=rows.slice(0,limit);return{decisions:page.map(toDecision),hasMore:rows.length>limit,...(rows.length>limit?{nextCursor:encodeCursor(page.at(-1)?.sequence??"0")}:{})}}
  async queue(scope: Scope | undefined, now: Date): Promise<QueueItem[]> {
    const rows = await this.sql<
      {
        payload: Candidate;
        round: number;
        kind: "initial" | "scheduled";
        due_at: Date | null;
      }[]
    >`SELECT c.payload,r.round,r.kind,r.due_at FROM candidates c JOIN LATERAL (SELECT * FROM review_rounds rr WHERE rr.candidate_id=c.candidate_id AND rr.verdict_id IS NULL ORDER BY round DESC LIMIT 1) r ON true WHERE (${scope ?? null}::text IS NULL OR c.payload->>'scope'=${scope ?? null}) AND (r.due_at IS NULL OR r.due_at<=${now}) ORDER BY COALESCE(r.due_at,c.created_at),c.candidate_id`;
    return rows.map((r) => ({
      candidate: r.payload,
      round: r.round,
      kind: r.kind,
      ...(r.due_at ? { dueAt: r.due_at.toISOString() } : {}),
      status: !r.due_at ? "pending" : r.due_at < now ? "overdue" : "due",
    }));
  }
  async decide(
    candidateId: string,
    round: number,
    input: VerdictInput,
    now: Date,
    reviewer: string,
  ) {
    return this.sql.begin(async (tx) => {
      const rows = await tx<
        {
          payload: Candidate;
          kind: "initial" | "scheduled";
          due_at: Date | null;
          verdict_id: string | null;
        }[]
      >`SELECT c.payload,r.kind,r.due_at,r.verdict_id FROM candidates c JOIN review_rounds r USING(candidate_id) WHERE c.candidate_id=${candidateId} AND r.round=${round} FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new Error("Candidate not found.");
      if (row.verdict_id)
        throw new ConflictError("Review round is already decided.");
      if(row.due_at&&row.due_at>now)throw new ConflictError("Review is not due yet.");
      const confirmations=await authoritativeConfirmations(tx,candidateId);
      const schedule=validateVerdict(row.kind,input,now,confirmations);
      const id = crypto.randomUUID();
      await tx`INSERT INTO verdict_events(decision_id,candidate_id,round,action,round_kind,effect,reviewer,reviewed_at,next_review_at) VALUES(${id},${candidateId},${round},${input.action},${row.kind},${schedule.effect},${reviewer},${now},${schedule.nextReviewAt ?? null})`;
      await tx`UPDATE review_rounds SET verdict_id=${id} WHERE candidate_id=${candidateId} AND round=${round}`;
      if (schedule.nextReviewAt && schedule.nextRoundKind)
        await tx`INSERT INTO review_rounds(candidate_id,round,kind,due_at) VALUES(${candidateId},${round + 1},${schedule.nextRoundKind},${schedule.nextReviewAt})`;
      const c = row.payload;
      return {
        decisionId: id,
        candidateId,
        round,
        action: input.action,
        roundKind:row.kind,
        effect:schedule.effect,
        isCurrent:true,
        canAmend:true,
        scope: c.scope,
        ...(c.scope==="project"?{projectKey:c.projectKey,projectDisplayName:c.projectDisplayName}:{}),
        lessonKey: c.lessonKey,
        title: c.title,
        body: c.body,
        evidence:c.evidence,
        reviewedAt: now.toISOString(),
        reviewer,
        ...(schedule.nextReviewAt ? { nextReviewAt: schedule.nextReviewAt.toISOString() } : {}),
      };
    });
  }
  async amendDecision(
    candidateId:string,
    round:number,
    input:AmendVerdictInput,
    now:Date,
    reviewer:string,
  ) {
    return this.sql.begin(async(tx)=>{
      const rows=await tx<{
        payload:Candidate;
        kind:RoundKind;
        verdict_id:string|null;
        action:Decision["action"]|null;
        next_review_at:Date|null;
      }[]>`SELECT c.payload,r.kind,r.verdict_id,current.action,current.next_review_at FROM candidates c JOIN review_rounds r USING(candidate_id) LEFT JOIN verdict_events current ON current.decision_id=r.verdict_id WHERE c.candidate_id=${candidateId} AND r.round=${round} FOR UPDATE OF c,r`;
      const row=rows[0];
      if(!row)throw new Error("Candidate not found.");
      if(!row.verdict_id||!row.action)throw new ConflictError("Review round has no decision to amend.");
      if(row.verdict_id!==input.expectedDecisionId)throw new ConflictError("Decision changed since it was loaded. Refresh and try again.");
      const descendants=await tx<{exists:boolean}[]>`SELECT EXISTS(SELECT 1 FROM review_rounds WHERE candidate_id=${candidateId} AND round>${round} AND verdict_id IS NOT NULL) exists`;
      if(descendants[0]?.exists)throw new ConflictError("This decision cannot be amended after a later round was decided.");
      if(row.action===input.action&&input.action!=="defer")throw new ValidationError("Choose a different verdict.");
      const confirmations=await authoritativeConfirmations(tx,candidateId);
      const schedule=validateVerdict(row.kind,input,now,confirmations);
      if(input.action==="defer"&&row.action==="defer"&&schedule.nextReviewAt?.getTime()===row.next_review_at?.getTime())throw new ValidationError("Choose a different defer date.");
      await tx`DELETE FROM review_rounds WHERE candidate_id=${candidateId} AND round=${round+1} AND verdict_id IS NULL`;
      const decisionId=crypto.randomUUID();
      await tx`INSERT INTO verdict_events(decision_id,candidate_id,round,action,round_kind,effect,amends_decision_id,reviewer,reviewed_at,next_review_at) VALUES(${decisionId},${candidateId},${round},${input.action},${row.kind},${schedule.effect},${row.verdict_id},${reviewer},${now},${schedule.nextReviewAt??null})`;
      await tx`UPDATE review_rounds SET verdict_id=${decisionId} WHERE candidate_id=${candidateId} AND round=${round}`;
      if(schedule.nextReviewAt&&schedule.nextRoundKind)await tx`INSERT INTO review_rounds(candidate_id,round,kind,due_at) VALUES(${candidateId},${round+1},${schedule.nextRoundKind},${schedule.nextReviewAt})`;
      const candidate=row.payload;
      return{
        decisionId,
        candidateId,
        round,
        action:input.action,
        roundKind:row.kind,
        effect:schedule.effect,
        amendsDecisionId:row.verdict_id,
        isCurrent:true,
        canAmend:true,
        scope:candidate.scope,
        ...(candidate.scope==="project"?{projectKey:candidate.projectKey,projectDisplayName:candidate.projectDisplayName}:{}),
        lessonKey:candidate.lessonKey,
        title:candidate.title,
        body:candidate.body,
        evidence:candidate.evidence,
        reviewedAt:now.toISOString(),
        reviewer,
        ...(schedule.nextReviewAt?{nextReviewAt:schedule.nextReviewAt.toISOString()}:{}),
      } satisfies Decision;
    });
  }
  async summary(now: Date): Promise<Summary> {
    const q = await this.queue(undefined, now);
    return {
      pending: q.filter((x) => x.status === "pending").length,
      due: q.filter((x) => x.status === "due").length,
      overdue: q.filter((x) => x.status === "overdue").length,
    };
  }
  async close() {
    await this.sql.end();
  }
}
const FIELD_GUIDE_SCHEMA = "public";
const BASELINE_COLUMNS: readonly BaselineColumn[] = [
  {tableName:"candidates",columnName:"candidate_id",dataType:"uuid",notNull:true},
  {tableName:"candidates",columnName:"idempotency_key",dataType:"text",notNull:true},
  {tableName:"candidates",columnName:"payload",dataType:"jsonb",notNull:true},
  {tableName:"candidates",columnName:"payload_hash",dataType:"text",notNull:true},
  {tableName:"candidates",columnName:"created_at",dataType:"timestamp with time zone",notNull:true},
  {tableName:"review_rounds",columnName:"candidate_id",dataType:"uuid",notNull:true},
  {tableName:"review_rounds",columnName:"round",dataType:"integer",notNull:true},
  {tableName:"review_rounds",columnName:"kind",dataType:"text",notNull:true},
  {tableName:"review_rounds",columnName:"due_at",dataType:"timestamp with time zone",notNull:false},
  {tableName:"review_rounds",columnName:"verdict_id",dataType:"uuid",notNull:false},
  {tableName:"verdict_events",columnName:"sequence",dataType:"bigint",notNull:true},
  {tableName:"verdict_events",columnName:"decision_id",dataType:"uuid",notNull:true},
  {tableName:"verdict_events",columnName:"candidate_id",dataType:"uuid",notNull:true},
  {tableName:"verdict_events",columnName:"round",dataType:"integer",notNull:true},
  {tableName:"verdict_events",columnName:"action",dataType:"text",notNull:true},
  {tableName:"verdict_events",columnName:"reviewer",dataType:"text",notNull:true},
  {tableName:"verdict_events",columnName:"reviewed_at",dataType:"timestamp with time zone",notNull:true},
  {tableName:"verdict_events",columnName:"next_review_at",dataType:"timestamp with time zone",notNull:false},
  {tableName:"application_receipts",columnName:"idempotency_key",dataType:"text",notNull:true},
  {tableName:"application_receipts",columnName:"payload_hash",dataType:"text",notNull:true},
  {tableName:"application_receipts",columnName:"decision_id",dataType:"uuid",notNull:true},
  {tableName:"application_receipts",columnName:"applied_at",dataType:"timestamp with time zone",notNull:true},
  {tableName:"application_receipts",columnName:"result",dataType:"text",notNull:true},
];
const BASELINE_CONSTRAINTS: readonly BaselineConstraint[] = [
  {name:"candidates_pkey",type:"p",columns:["candidate_id"]},
  {name:"candidates_idempotency_key_key",type:"u",columns:["idempotency_key"]},
  {name:"review_rounds_pkey",type:"p",columns:["candidate_id","round"]},
  {name:"review_rounds_verdict_id_key",type:"u",columns:["verdict_id"]},
  {name:"review_rounds_candidate_id_fkey",type:"f",columns:["candidate_id"],referencedSchema:"public",referencedTable:"candidates",referencedColumns:["candidate_id"]},
  {name:"review_rounds_kind_check",type:"c",columns:["kind"],checkValues:["initial","scheduled"]},
  {name:"verdict_events_pkey",type:"p",columns:["sequence"]},
  {name:"verdict_events_decision_id_key",type:"u",columns:["decision_id"]},
  {name:"verdict_events_candidate_id_round_key",type:"u",columns:["candidate_id","round"]},
  {name:"verdict_events_candidate_id_round_fkey",type:"f",columns:["candidate_id","round"],referencedSchema:"public",referencedTable:"review_rounds",referencedColumns:["candidate_id","round"]},
  {name:"application_receipts_pkey",type:"p",columns:["idempotency_key"]},
  {name:"application_receipts_decision_id_fkey",type:"f",columns:["decision_id"],referencedSchema:"public",referencedTable:"verdict_events",referencedColumns:["decision_id"]},
  {name:"application_receipts_result_check",type:"c",columns:["result"],checkValues:["applied","already_applied"]},
];

function validateBaselineColumns(columns:BaselineColumn[]){
  const actual=new Map(columns.map((column)=>[`${column.tableName}.${column.columnName}`,column]));
  for(const expected of BASELINE_COLUMNS){
    const column=actual.get(`${expected.tableName}.${expected.columnName}`);
    if(!column||column.dataType!==expected.dataType||column.notNull!==expected.notNull)
      throw new Error("Cannot adopt an incompatible field-guide schema.");
  }
}

function validateBaselineConstraints(constraints:BaselineConstraint[]){
  const actual=new Map(constraints.map((constraint)=>[constraint.name,constraint]));
  for(const expected of BASELINE_CONSTRAINTS){
    const constraint=actual.get(expected.name);
    const checkIsCompatible=!expected.checkValues||(
      constraint?.definition?.includes("= ANY (ARRAY[")===true&&
      sameStrings(quotedValues(constraint.definition),expected.checkValues)
    );
    const timingIsCompatible=constraint?.deferrable===false&&constraint.initiallyDeferred===false;
    const foreignActionsAreCompatible=expected.type!=="f"||(
      constraint?.foreignDeleteAction==="a"&&constraint.foreignUpdateAction==="a"
      &&constraint.foreignMatchType==="s"
    );
    if(!constraint||constraint.type!==expected.type||!sameStrings(constraint.columns,expected.columns)||
      constraint.referencedTable!==expected.referencedTable||
      constraint.referencedSchema!==expected.referencedSchema||
      !sameStrings(constraint.referencedColumns??[],expected.referencedColumns??[])||
      !checkIsCompatible||!timingIsCompatible||!foreignActionsAreCompatible)
      throw new Error("Cannot adopt an incompatible field-guide schema.");
  }
}

const sameStrings=(left:readonly string[],right:readonly string[])=>
  left.length===right.length&&left.every((value,index)=>value===right[index]);
const quotedValues=(definition:string)=>
  [...definition.matchAll(/'((?:''|[^'])*)'/g)].map((match)=>match[1]?.replace(/''/g,"'")??"");
const digest = (value: object) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const digestText = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");
const MIGRATION_LOCK = 719_873_492;
export const containsTransactionControl = (sql: string) =>
  /(?:^|;)\s*(?:BEGIN\b|START\s+TRANSACTION\b|COMMIT\b|ROLLBACK\b|ABORT\b|SAVEPOINT\b|RELEASE(?:\s+SAVEPOINT)?\b)/im.test(
    stripDollarQuotedBodies(sql)
      .replace(/--[^\r\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, ""),
  );
function stripDollarQuotedBodies(sql:string){
  const delimiter=/\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/g;
  let result="",offset=0,match:RegExpExecArray|null;
  while((match=delimiter.exec(sql))!==null){
    const closing=sql.indexOf(match[0],delimiter.lastIndex);
    if(closing<0)break;
    result+=sql.slice(offset,match.index)+" ";
    offset=closing+match[0].length;
    delimiter.lastIndex=offset;
  }
  return result+sql.slice(offset);
}
const isUnique = (e: unknown) =>
  typeof e === "object" &&
  e !== null &&
  "code" in e &&
  (e as { code?: unknown }).code === "23505";
function toDecision(r: EventRow): Decision {
  const c = r.payload;
  return {
    decisionId: r.decision_id,
    candidateId: r.candidate_id,
    round: r.round,
    action: r.action,
    roundKind:r.round_kind,
    effect:r.effect,
    ...(r.amends_decision_id?{amendsDecisionId:r.amends_decision_id}:{}),
    isCurrent:r.is_current,
    canAmend:r.can_amend,
    scope: c.scope,
    ...(c.scope==="project"?{projectKey:c.projectKey,projectDisplayName:c.projectDisplayName}:{}),
    lessonKey: c.lessonKey,
    title: c.title,
    body: c.body,
    evidence:c.evidence,
    reviewedAt: r.reviewed_at.toISOString(),
    reviewer:r.reviewer,
    ...(r.next_review_at
      ? { nextReviewAt: r.next_review_at.toISOString() }
      : {}),
  };
}

function eventProjection(sql:Sql,scope:Scope|undefined){
  return sql`SELECT v.sequence,v.decision_id,v.candidate_id,v.round,v.action,v.round_kind,v.effect,v.amends_decision_id,v.reviewer,v.reviewed_at,v.next_review_at,c.payload,(r.verdict_id=v.decision_id) is_current,((r.verdict_id=v.decision_id) AND NOT EXISTS(SELECT 1 FROM review_rounds later WHERE later.candidate_id=v.candidate_id AND later.round>v.round AND later.verdict_id IS NOT NULL)) can_amend FROM verdict_events v JOIN candidates c USING(candidate_id) JOIN review_rounds r ON r.candidate_id=v.candidate_id AND r.round=v.round WHERE (${scope??null}::text IS NULL OR c.payload->>'scope'=${scope??null})`;
}

async function authoritativeConfirmations(sql:TransactionSql,candidateId:string){
  const rows=await sql<{count:number}[]>`SELECT COUNT(*)::int count FROM review_rounds r JOIN verdict_events v ON v.decision_id=r.verdict_id WHERE r.candidate_id=${candidateId} AND v.action='confirm_valid'`;
  return rows[0]?.count??0;
}
