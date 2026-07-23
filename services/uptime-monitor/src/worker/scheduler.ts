import { runMonitorCheck } from "./checker";
import { drainOneNotification } from "./notifications";
import { runRetentionOnceDaily } from "./retention";
import type { Env } from "./env";

interface ScheduledRow { id:number }
export const MAX_MONITORING_SUBREQUESTS=16;
export const MAX_TOTAL_SUBREQUESTS=17;
export function scheduledSlot(at:Date):number{return at.getUTCMinutes()%5;}
export async function mapConcurrent<T>(values:readonly T[],limit:number,fn:(value:T)=>Promise<void>):Promise<void>{
  let cursor=0; const worker=async()=>{while(cursor<values.length){const index=cursor;cursor+=1;try{await fn(values[index]);}catch{ /* one monitor must not abort the invocation */ }}};
  await Promise.all(Array.from({length:Math.min(limit,values.length)},worker));
}
export async function runScheduled(env:Env,at=new Date()):Promise<void>{
  const rows=(await env.DB.prepare("SELECT id FROM monitors WHERE enabled=1 AND schedule_slot=? ORDER BY id LIMIT 8").bind(scheduledSlot(at)).all<ScheduledRow>()).results;
  await mapConcurrent(rows,6,(row)=>runMonitorCheck(env,row.id));
  await drainOneNotification(env);
  await runRetentionOnceDaily(env,at);
}
