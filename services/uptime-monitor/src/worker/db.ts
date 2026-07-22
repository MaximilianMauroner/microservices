import type { CheckResult } from "../domain/check";
import { applyObservation } from "../domain/status";
import type { HistoryResponse, IncidentRecord, MonitorSummary, MonitorStatus } from "../shared/contracts";

interface MonitorRow { id: number; name: string; url: string; enabled: number; status: MonitorStatus; latest_latency_ms: number | null; latest_status_code: number | null; last_checked_at: string | null; consecutive_failures: number; schedule_slot: number; version: number }
interface CountRow { count: number; schedule_slot?: number }
interface CheckRow { id: string; checked_at: string; success: number; status_code: number | null; latency_ms: number; error_code: string | null }
interface IncidentRow { id: number; started_at: string; resolved_at: string | null; down_delivered_at: string | null; recovery_delivered_at: string | null }
interface IdRow { id: number }

function summary(row: MonitorRow, uptime24h: number | null = null, uptime30d: number | null = null): MonitorSummary {
  return { id: row.id, name: row.name, url: row.url, hostname: new URL(row.url).hostname, enabled: row.enabled === 1, status: row.status, latestLatencyMs: row.latest_latency_ms, latestStatusCode: row.latest_status_code, lastCheckedAt: row.last_checked_at, uptime24h, uptime30d, scheduleSlot: row.schedule_slot };
}

export function chooseScheduleSlot(counts:ReadonlyMap<number,number>):number|null{
  const available=[0,1,2,3,4].map((slot)=>({slot,count:counts.get(slot)??0})).filter((entry)=>entry.count<8).sort((a,b)=>a.count-b.count||a.slot-b.slot);
  return available[0]?.slot??null;
}

export async function listMonitors(db: D1Database): Promise<MonitorSummary[]> {
  const result = await db.prepare(`SELECT m.*, ROUND(100.0*SUM(CASE WHEN c.success=1 AND c.checked_at >= datetime('now','-24 hours') THEN 1 ELSE 0 END)/NULLIF(SUM(CASE WHEN c.checked_at >= datetime('now','-24 hours') THEN 1 ELSE 0 END),0),2) uptime24h,
    ROUND(100.0*SUM(CASE WHEN c.success=1 AND c.checked_at >= datetime('now','-30 days') THEN 1 ELSE 0 END)/NULLIF(SUM(CASE WHEN c.checked_at >= datetime('now','-30 days') THEN 1 ELSE 0 END),0),2) uptime30d
    FROM monitors m LEFT JOIN checks c ON c.monitor_id=m.id AND c.checked_at >= datetime('now','-30 days') GROUP BY m.id ORDER BY m.created_at`).all<MonitorRow & { uptime24h: number | null; uptime30d: number | null }>();
  return result.results.map((row) => summary(row, row.uptime24h, row.uptime30d));
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

export async function recordObservation(db: D1Database, monitor: MonitorRow, result: CheckResult): Promise<boolean> {
  const open = await db.prepare("SELECT id FROM incidents WHERE monitor_id=? AND resolved_at IS NULL").bind(monitor.id).first<IdRow>();
  const state = applyObservation({ status: monitor.status === "paused" ? "checking" : monitor.status, consecutiveFailures: monitor.consecutive_failures, openIncidentId: open?.id ?? null }, result.success);
  const token=crypto.randomUUID(); const checkId=crypto.randomUUID();
  const statements=[
    db.prepare("UPDATE monitors SET status=?,consecutive_failures=?,latest_latency_ms=?,latest_status_code=?,last_checked_at=?,observation_token=?,version=version+1,updated_at=? WHERE id=? AND version=? AND enabled=1").bind(state.status,state.consecutiveFailures,result.latencyMs,result.statusCode,result.checkedAt,token,result.checkedAt,monitor.id,monitor.version),
    db.prepare("INSERT INTO checks(id,monitor_id,observation_token,checked_at,success,status_code,latency_ms,error_code) VALUES(?,?,?,?,?,?,?,?)").bind(checkId,monitor.id,token,result.checkedAt,result.success ? 1 : 0,result.statusCode,result.latencyMs,result.errorCode),
  ];
  if(state.transition==="down")statements.push(db.prepare("INSERT OR IGNORE INTO incidents(monitor_id,started_at,opening_check_id,down_next_attempt_at) VALUES(?,?,?,?)").bind(monitor.id,result.checkedAt,checkId,result.checkedAt));
  if(state.transition==="recovery"&&open)statements.push(db.prepare("UPDATE incidents SET resolved_at=?,closing_check_id=?,recovery_next_attempt_at=? WHERE id=? AND resolved_at IS NULL").bind(result.checkedAt,checkId,result.checkedAt,open.id));
  try{await db.batch(statements);return true;}catch(error){if(error instanceof Error&&error.message.includes("observation_conflict"))return false;throw error;}
}

export async function history(db:D1Database,id:number,window:"24h"|"30d"):Promise<HistoryResponse>{
  const modifier=window==="24h"?"-24 hours":"-30 days";
  const checks=(await db.prepare("SELECT * FROM checks WHERE monitor_id=? AND checked_at >= datetime('now',?) ORDER BY checked_at DESC LIMIT 500").bind(id,modifier).all<CheckRow>()).results;
  const incidents=(await db.prepare("SELECT * FROM incidents WHERE monitor_id=? AND started_at >= datetime('now',?) ORDER BY started_at DESC").bind(id,modifier).all<IncidentRow>()).results;
  const values=checks.map((row)=>({id:row.id,checkedAt:row.checked_at,success:row.success===1,statusCode:row.status_code,latencyMs:row.latency_ms,errorCode:row.error_code as HistoryResponse["checks"][number]["errorCode"]}));
  const uptime=values.length?Math.round(values.filter((v)=>v.success).length/values.length*10000)/100:null;
  return { uptime, checks:values, incidents:incidents.map((row):IncidentRecord=>({id:row.id,startedAt:row.started_at,resolvedAt:row.resolved_at,downDeliveredAt:row.down_delivered_at,recoveryDeliveredAt:row.recovery_delivered_at})), buckets:values.slice(0,96).reverse().map((v)=>({at:v.checkedAt,latencyMs:v.latencyMs,success:v.success})) };
}

export async function rateLimit(db:D1Database,key:string,limit:number,windowSeconds:number):Promise<boolean>{
  const cutoff=new Date(Date.now()-windowSeconds*1000).toISOString(); const now=new Date().toISOString();
  await db.prepare("INSERT INTO rate_limits(key,window_started_at,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_started_at=CASE WHEN window_started_at < ? THEN excluded.window_started_at ELSE window_started_at END,count=CASE WHEN window_started_at < ? THEN 1 ELSE count+1 END").bind(key,now,cutoff,cutoff).run();
  const row=await db.prepare("SELECT count FROM rate_limits WHERE key=?").bind(key).first<CountRow>(); return (row?.count??limit+1)<=limit;
}

export type { MonitorRow };
