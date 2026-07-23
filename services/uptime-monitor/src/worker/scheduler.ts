import { runMonitorCheck } from "./checker";
import { drainOneNotification } from "./notifications";
import { runRetentionOnceDaily } from "./retention";
import type { Env } from "./env";

interface ScheduledRow { id:number }
type ScheduledFailureCategory="observation_conflict"|"database_error"|"unexpected_error";
export const MAX_MONITORING_SUBREQUESTS=16;
export const MAX_TOTAL_SUBREQUESTS=17;
export function scheduledSlot(at:Date):number{return at.getUTCMinutes()%5;}
export function scheduledFailureCategory(error:unknown):ScheduledFailureCategory{
  if(error instanceof Error&&error.message==="observation_retry_exhausted")return"observation_conflict";
  if(error instanceof Error&&(error.name==="D1_ERROR"||error.message.startsWith("D1_")))return"database_error";
  return"unexpected_error";
}
export function logScheduledFailure(monitorId:number,error:unknown):void{
  console.error({event:"scheduled_monitor_failed",monitorId,category:scheduledFailureCategory(error)});
}
export async function mapConcurrent<T>(values:readonly T[],limit:number,fn:(value:T)=>Promise<void>,onError?:(value:T,error:unknown)=>void):Promise<void>{
  let cursor=0; const worker=async()=>{while(cursor<values.length){const index=cursor;cursor+=1;try{await fn(values[index]);}catch(error){onError?.(values[index],error);}}};
  await Promise.all(Array.from({length:Math.min(limit,values.length)},worker));
}
export async function runScheduled(env:Env,at=new Date()):Promise<void>{
  const rows=(await env.DB.prepare("SELECT id FROM monitors WHERE enabled=1 AND schedule_slot=? ORDER BY id LIMIT 8").bind(scheduledSlot(at)).all<ScheduledRow>()).results;
  await mapConcurrent(rows,6,(row)=>runMonitorCheck(env,row.id),(row,error)=>logScheduledFailure(row.id,error));
  await drainOneNotification(env);
  await runRetentionOnceDaily(env,at);
}
