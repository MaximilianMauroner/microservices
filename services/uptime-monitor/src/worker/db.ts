import type { CheckResult } from "../domain/check";
import type { HistoryResponse, IncidentRecord, MonitorSummary, MonitorStatus } from "../shared/contracts";

interface MonitorRow { id: number; name: string; url: string; enabled: number; status: MonitorStatus; latest_latency_ms: number | null; latest_status_code: number | null; last_checked_at: string | null; consecutive_failures: number; schedule_slot: number; version: number }
interface CountRow { count: number; schedule_slot?: number }
interface CheckRow { id: string; checked_at: string; success: number; status_code: number | null; latency_ms: number; error_code: string | null }
interface IncidentRow { id: number; started_at: string; resolved_at: string | null; opening_check_id: string | null; closing_check_id: string | null; down_delivered_at: string | null; recovery_delivered_at: string | null; opening_checked_at?: string | null; closing_checked_at?: string | null }
interface MetricRow { completed: number; successful: number }
interface BucketRow { bucket_at: number; latency_ms: number | null; completed: number; successful: number }
interface FoldedIncident { openingCheckId:string; startedAt:string; closingCheckId:string|null; resolvedAt:string|null }
interface ObservationReadCounts { checks:number;incidents:number }

function summary(row: MonitorRow, uptime24h: number | null = null, uptime30d: number | null = null): MonitorSummary {
  return { id: row.id, name: row.name, url: row.url, hostname: new URL(row.url).hostname, enabled: row.enabled === 1, status: row.status, latestLatencyMs: row.latest_latency_ms, latestStatusCode: row.latest_status_code, lastCheckedAt: row.last_checked_at, uptime24h, uptime30d, scheduleSlot: row.schedule_slot };
}

export function chooseScheduleSlot(counts:ReadonlyMap<number,number>):number|null{
  const available=[0,1,2,3,4].map((slot)=>({slot,count:counts.get(slot)??0})).filter((entry)=>entry.count<8).sort((a,b)=>a.count-b.count||a.slot-b.slot);
  return available[0]?.slot??null;
}

export async function listMonitors(db: D1Database): Promise<MonitorSummary[]> {
  const result = await db.prepare(`SELECT m.*, ROUND(100.0*SUM(CASE WHEN c.success=1 AND unixepoch(c.checked_at) >= unixepoch('now','-24 hours') THEN 1 ELSE 0 END)/NULLIF(SUM(CASE WHEN unixepoch(c.checked_at) >= unixepoch('now','-24 hours') THEN 1 ELSE 0 END),0),2) uptime24h,
    ROUND(100.0*SUM(CASE WHEN c.success=1 AND unixepoch(c.checked_at) >= unixepoch('now','-30 days') THEN 1 ELSE 0 END)/NULLIF(SUM(CASE WHEN unixepoch(c.checked_at) >= unixepoch('now','-30 days') THEN 1 ELSE 0 END),0),2) uptime30d
    FROM monitors m LEFT JOIN checks c ON c.monitor_id=m.id AND unixepoch(c.checked_at) BETWEEN unixepoch('now','-30 days') AND unixepoch('now') GROUP BY m.id ORDER BY m.created_at`).all<MonitorRow & { uptime24h: number | null; uptime30d: number | null }>();
  return result.results.map((row) => summary(row, row.uptime24h, row.uptime30d));
}

export async function listMonitorStates(db: D1Database): Promise<MonitorSummary[]> {
  const result=await db.prepare("SELECT * FROM monitors ORDER BY created_at").all<MonitorRow>();
  return result.results.map((row)=>summary(row));
}

export async function getMonitor(db: D1Database, id: number): Promise<MonitorRow | null> { return db.prepare("SELECT * FROM monitors WHERE id=?").bind(id).first<MonitorRow>(); }

export async function createMonitor(db: D1Database, name: string, url: string): Promise<MonitorSummary> {
  for(let attempt=0;attempt<6;attempt+=1){
    const counts = await db.prepare("SELECT schedule_slot, COUNT(*) count FROM monitors GROUP BY schedule_slot").all<CountRow>();
    const map = new Map(counts.results.map((row) => [row.schedule_slot ?? 0,row.count]));
    const slot=chooseScheduleSlot(map); if(slot===null) throw new Error("monitor_limit_reached");
    const now = new Date().toISOString();
    const created = await db.prepare("INSERT INTO monitors(name,url,schedule_slot,created_at,updated_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM monitors WHERE schedule_slot=?) < 8 RETURNING *").bind(name,url,slot,now,now,slot).first<MonitorRow>();
    if(created)return summary(created);
  }
  throw new Error("slot_conflict");
}

export async function updateMonitor(db: D1Database, id: number, patch: { name?: string; url?: string; enabled?: boolean }): Promise<MonitorSummary | null> {
  const current = await getMonitor(db,id); if (!current) return null;
  const name = patch.name ?? current.name; const url = patch.url ?? current.url; const enabled = patch.enabled ?? current.enabled === 1;
  const reset = patch.url !== undefined || (patch.enabled === true && current.enabled === 0);
  const status: MonitorStatus = enabled ? (reset ? "checking" : current.status === "paused" ? "checking" : current.status) : "paused";
  const result = await db.prepare("UPDATE monitors SET name=?,url=?,enabled=?,status=?,consecutive_failures=CASE WHEN ? THEN 0 ELSE consecutive_failures END,version=version+1,updated_at=? WHERE id=? RETURNING *")
    .bind(name,url,enabled ? 1 : 0,status,reset ? 1 : 0,new Date().toISOString(),id).first<MonitorRow>();
  return result ? summary(result) : null;
}
export async function deleteMonitor(db: D1Database,id:number):Promise<boolean>{ const result=await db.prepare("DELETE FROM monitors WHERE id=?").bind(id).run(); return (result.meta.changes ?? 0)>0; }

function compareChecks(left:Pick<CheckRow,"checked_at"|"id">,right:Pick<CheckRow,"checked_at"|"id">):number{
  return left.checked_at.localeCompare(right.checked_at)||left.id.localeCompare(right.id);
}

async function failuresBetween(db:D1Database,monitorId:number,lower:CheckRow|null,upper:CheckRow|null):Promise<CheckRow[]>{
  const result=await db.prepare(`SELECT id,checked_at,success,status_code,latency_ms,error_code FROM checks WHERE monitor_id=? AND success=0
    AND (? IS NULL OR checked_at>? OR (checked_at=? AND id>?))
    AND (? IS NULL OR checked_at<? OR (checked_at=? AND id<?))
    ORDER BY checked_at,id LIMIT 2`).bind(monitorId,lower?.checked_at??null,lower?.checked_at??null,lower?.checked_at??null,lower?.id??null,upper?.checked_at??null,upper?.checked_at??null,upper?.checked_at??null,upper?.id??null).all<CheckRow>();
  return result.results;
}

function incidentForFailures(failures:readonly CheckRow[],closing:CheckRow|null):FoldedIncident|null{
  const opening=[...failures].sort(compareChecks)[1];if(!opening)return null;
  return{openingCheckId:opening.id,startedAt:opening.checked_at,closingCheckId:closing?.id??null,resolvedAt:closing?.checked_at??null};
}

function incidentsOverlap(existing:IncidentRow,desired:FoldedIncident):boolean{
  const desiredStart={checked_at:desired.startedAt,id:desired.openingCheckId};
  const desiredEnd=desired.resolvedAt===null?null:{checked_at:desired.resolvedAt,id:desired.closingCheckId??""};
  const existingStart={checked_at:existing.opening_checked_at??existing.started_at,id:existing.opening_check_id??""};
  const existingEnd=existing.resolved_at===null?null:{checked_at:existing.closing_checked_at??existing.resolved_at,id:existing.closing_check_id??""};
  return(desiredEnd===null||compareChecks(existingStart,desiredEnd)<=0)&&(existingEnd===null||compareChecks(existingEnd,desiredStart)>=0);
}

function incidentStartsBetween(existing:IncidentRow,lower:CheckRow|null,upper:CheckRow|null):boolean{
  if(existing.opening_check_id===null||existing.opening_checked_at===null||existing.opening_checked_at===undefined)return false;
  const opening={checked_at:existing.opening_checked_at,id:existing.opening_check_id};
  return(lower===null||compareChecks(opening,lower)>0)&&(upper===null||compareChecks(opening,upper)<0);
}

export async function recordObservation(db: D1Database, monitor: MonitorRow, result: CheckResult, checkId=crypto.randomUUID(),observeReads?:(counts:ObservationReadCounts)=>void): Promise<boolean> {
  const candidate:CheckRow={id:checkId,checked_at:result.checkedAt,success:result.success?1:0,status_code:result.statusCode,latency_ms:result.latencyMs,error_code:result.errorCode};
  const select="SELECT id,checked_at,success,status_code,latency_ms,error_code FROM checks";
  const [latest,previousSuccess,nextSuccess,lastSuccess]=await Promise.all([
    db.prepare(`${select} WHERE monitor_id=? ORDER BY checked_at DESC,id DESC LIMIT 1`).bind(monitor.id).first<CheckRow>(),
    db.prepare(`${select} WHERE monitor_id=? AND success=1 AND (checked_at<? OR (checked_at=? AND id<?)) ORDER BY checked_at DESC,id DESC LIMIT 1`).bind(monitor.id,candidate.checked_at,candidate.checked_at,candidate.id).first<CheckRow>(),
    db.prepare(`${select} WHERE monitor_id=? AND success=1 AND (checked_at>? OR (checked_at=? AND id>?)) ORDER BY checked_at,id LIMIT 1`).bind(monitor.id,candidate.checked_at,candidate.checked_at,candidate.id).first<CheckRow>(),
    db.prepare(`${select} WHERE monitor_id=? AND success=1 ORDER BY checked_at DESC,id DESC LIMIT 1`).bind(monitor.id).first<CheckRow>(),
  ]);
  const segmentQueries=result.success
    ? [failuresBetween(db,monitor.id,previousSuccess,candidate),failuresBetween(db,monitor.id,candidate,nextSuccess)]
    : [failuresBetween(db,monitor.id,previousSuccess,nextSuccess)];
  const segmentFailures=await Promise.all(segmentQueries);
  const desiredIncidents=result.success
    ? [incidentForFailures(segmentFailures[0],candidate),incidentForFailures(segmentFailures[1],nextSuccess)].filter((incident):incident is FoldedIncident=>incident!==null)
    : [incidentForFailures([...segmentFailures[0],candidate],nextSuccess)].filter((incident):incident is FoldedIncident=>incident!==null);
  const lower=previousSuccess?.checked_at??null;const upper=nextSuccess?.checked_at??null;
  const incidentsResult=await db.prepare(`SELECT i.*,opening.checked_at opening_checked_at,closing.checked_at closing_checked_at
    FROM incidents i
    LEFT JOIN checks opening ON opening.id=i.opening_check_id
    LEFT JOIN checks closing ON closing.id=i.closing_check_id
    WHERE i.monitor_id=?
      AND (
        (opening.id IS NOT NULL
          AND (? IS NULL OR opening.checked_at>? OR (opening.checked_at=? AND opening.id>?))
          AND (? IS NULL OR opening.checked_at<? OR (opening.checked_at=? AND opening.id<?)))
        OR
        (opening.id IS NULL
          AND (? IS NULL OR i.started_at<=?)
          AND (i.resolved_at IS NULL OR ? IS NULL OR i.resolved_at>=?))
      )
    ORDER BY i.started_at,i.id LIMIT 4`).bind(
      monitor.id,
      previousSuccess?.checked_at??null,previousSuccess?.checked_at??null,previousSuccess?.checked_at??null,previousSuccess?.id??null,
      nextSuccess?.checked_at??null,nextSuccess?.checked_at??null,nextSuccess?.checked_at??null,nextSuccess?.id??null,
      upper,upper,lower,lower,
    ).all<IncidentRow>();
  let consecutiveFailures=monitor.consecutive_failures;
  const candidateAfterLastSuccess=lastSuccess===null||compareChecks(candidate,lastSuccess)>0;
  if(candidateAfterLastSuccess){
    if(result.success){
      consecutiveFailures=segmentFailures[1]?.length??0;
    }else consecutiveFailures=Math.min(2,consecutiveFailures+1);
  }
  const status:MonitorStatus=consecutiveFailures===0?"up":consecutiveFailures===1?"checking":"down";
  const newest=latest===null||compareChecks(candidate,latest)>0?candidate:latest;
  observeReads?.({checks:[latest,previousSuccess,nextSuccess,lastSuccess].filter((row)=>row!==null).length+segmentFailures.reduce((count,rows)=>count+rows.length,0),incidents:incidentsResult.results.length});
  const token=crypto.randomUUID();
  const statements:D1PreparedStatement[]=[
    db.prepare("UPDATE monitors SET status=?,consecutive_failures=?,latest_latency_ms=?,latest_status_code=?,last_checked_at=?,observation_token=?,version=version+1,updated_at=? WHERE id=? AND version=? AND enabled=1").bind(status,consecutiveFailures,newest.latency_ms,newest.status_code,newest.checked_at,token,newest.checked_at,monitor.id,monitor.version),
    db.prepare("INSERT INTO checks(id,monitor_id,observation_token,checked_at,success,status_code,latency_ms,error_code) VALUES(?,?,?,?,?,?,?,?)").bind(checkId,monitor.id,token,result.checkedAt,result.success ? 1 : 0,result.statusCode,result.latencyMs,result.errorCode),
  ];
  const unused=[...incidentsResult.results];
  const matches=new Map<FoldedIncident,IncidentRow>();
  const assign=(predicate:(existing:IncidentRow,desired:FoldedIncident)=>boolean)=>{
    for(const desired of desiredIncidents){
      if(matches.has(desired))continue;
      const index=unused.findIndex((existing)=>predicate(existing,desired));
      if(index>=0)matches.set(desired,unused.splice(index,1)[0]);
    }
  };
  assign((existing,desired)=>existing.opening_check_id===desired.openingCheckId);
  assign((existing,desired)=>existing.closing_check_id!==null&&existing.closing_check_id===desired.closingCheckId);
  assign(incidentsOverlap);
  for(const desired of desiredIncidents){
    const existing=matches.get(desired);
    if(existing?.opening_check_id===null)statements.push(db.prepare("UPDATE incidents SET resolved_at=?,closing_check_id=? WHERE id=?").bind(desired.resolvedAt,desired.closingCheckId,existing.id));
    else if(existing)statements.push(db.prepare("UPDATE incidents SET started_at=?,resolved_at=?,opening_check_id=?,closing_check_id=? WHERE id=?").bind(desired.startedAt,desired.resolvedAt,desired.openingCheckId,desired.closingCheckId,existing.id));
    else statements.push(db.prepare("INSERT INTO incidents(monitor_id,started_at,resolved_at,opening_check_id,closing_check_id,down_next_attempt_at,recovery_next_attempt_at) VALUES(?,?,?,?,?,?,?)").bind(monitor.id,desired.startedAt,desired.resolvedAt,desired.openingCheckId,desired.closingCheckId,desired.startedAt,desired.resolvedAt));
  }
  for(const stale of unused){
    if(stale.opening_check_id===null){
      if(stale.resolved_at===null&&result.success)statements.push(db.prepare("UPDATE incidents SET resolved_at=?,closing_check_id=? WHERE id=? AND resolved_at IS NULL").bind(candidate.checked_at,candidate.id,stale.id));
      continue;
    }
    if(incidentStartsBetween(stale,previousSuccess,nextSuccess))statements.push(db.prepare("DELETE FROM incidents WHERE id=?").bind(stale.id));
  }
  try{await db.batch(statements);return true;}catch(error){if(error instanceof Error&&error.message.includes("observation_conflict"))return false;throw error;}
}

interface HistoryCursor { checkedAt:string; id:string }
export function encodeHistoryCursor(row:HistoryCursor):string{return btoa(JSON.stringify(row)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");}
export function decodeHistoryCursor(value:string):HistoryCursor{
  try{const normalized=value.replaceAll("-","+").replaceAll("_","/");const parsed:unknown=JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,"=")));if(typeof parsed!=="object"||parsed===null||!("checkedAt" in parsed)||!("id" in parsed)||typeof parsed.checkedAt!=="string"||typeof parsed.id!=="string"||Number.isNaN(Date.parse(parsed.checkedAt))||!parsed.id)throw new Error("invalid_cursor");return{checkedAt:parsed.checkedAt,id:parsed.id};}catch{throw new Error("invalid_cursor");}
}
export async function history(db:D1Database,id:number,window:"24h"|"30d",cursorValue?:string,now=new Date()):Promise<HistoryResponse>{
  const durationSeconds=window==="24h"?24*60*60:30*24*60*60; const current=Math.floor(now.valueOf()/1000); const cutoff=current-durationSeconds; const bucketSeconds=durationSeconds/96;
  const metric=await db.prepare("SELECT COUNT(*) completed,COALESCE(SUM(success),0) successful FROM checks WHERE monitor_id=? AND unixepoch(checked_at) BETWEEN ? AND ?").bind(id,cutoff,current).first<MetricRow>();
  const cursor=cursorValue?decodeHistoryCursor(cursorValue):null;
  const query=cursor
    ? "SELECT * FROM checks WHERE monitor_id=? AND unixepoch(checked_at) BETWEEN ? AND ? AND (unixepoch(checked_at)<unixepoch(?) OR (unixepoch(checked_at)=unixepoch(?) AND id<?)) ORDER BY unixepoch(checked_at) DESC,id DESC LIMIT 101"
    : "SELECT * FROM checks WHERE monitor_id=? AND unixepoch(checked_at) BETWEEN ? AND ? ORDER BY unixepoch(checked_at) DESC,id DESC LIMIT 101";
  const result=cursor?await db.prepare(query).bind(id,cutoff,current,cursor.checkedAt,cursor.checkedAt,cursor.id).all<CheckRow>():await db.prepare(query).bind(id,cutoff,current).all<CheckRow>();
  const page=result.results.slice(0,100); const last=page.at(-1); const nextCursor=result.results.length>100&&last?encodeHistoryCursor({checkedAt:last.checked_at,id:last.id}):null;
  const incidents=(await db.prepare("SELECT * FROM incidents WHERE monitor_id=? AND unixepoch(started_at)<=? AND (resolved_at IS NULL OR unixepoch(resolved_at)>=?) ORDER BY unixepoch(started_at) DESC").bind(id,current,cutoff).all<IncidentRow>()).results;
  const buckets=(await db.prepare(`WITH RECURSIVE bucket(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM bucket WHERE n<95)
    SELECT ?+bucket.n*? bucket_at,ROUND(AVG(c.latency_ms)) latency_ms,COUNT(c.id) completed,COALESCE(SUM(c.success),0) successful
    FROM bucket LEFT JOIN checks c ON c.monitor_id=? AND unixepoch(c.checked_at)>=?+bucket.n*? AND unixepoch(c.checked_at)<CASE WHEN bucket.n=95 THEN ? ELSE ?+(bucket.n+1)*? END
    GROUP BY bucket.n ORDER BY bucket.n`).bind(cutoff,bucketSeconds,id,cutoff,bucketSeconds,current+1,cutoff,bucketSeconds).all<BucketRow>()).results;
  const checks=page.map((row)=>({id:row.id,checkedAt:row.checked_at,success:row.success===1,statusCode:row.status_code,latencyMs:row.latency_ms,errorCode:row.error_code as HistoryResponse["checks"][number]["errorCode"]}));
  const completed=metric?.completed??0; const uptime=completed?Math.round((metric?.successful??0)/completed*10000)/100:null;
  return { uptime,checks,nextCursor,incidents:incidents.map((row):IncidentRecord=>({id:row.id,startedAt:row.started_at,resolvedAt:row.resolved_at,downDeliveredAt:row.down_delivered_at,recoveryDeliveredAt:row.recovery_delivered_at})),buckets:buckets.map((row)=>({at:new Date(row.bucket_at*1000).toISOString(),latencyMs:row.latency_ms,success:row.completed>0&&row.successful===row.completed})) };
}

export async function rateLimit(db:D1Database,key:string,limit:number,windowSeconds:number):Promise<boolean>{
  const cutoff=Math.floor(Date.now()/1000)-windowSeconds; const now=new Date().toISOString();
  await db.prepare("INSERT INTO rate_limits(key,window_started_at,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_started_at=CASE WHEN unixepoch(window_started_at) < ? THEN excluded.window_started_at ELSE window_started_at END,count=CASE WHEN unixepoch(window_started_at) < ? THEN 1 ELSE count+1 END").bind(key,now,cutoff,cutoff).run();
  const row=await db.prepare("SELECT count FROM rate_limits WHERE key=?").bind(key).first<CountRow>(); return (row?.count??limit+1)<=limit;
}

export type { MonitorRow };
