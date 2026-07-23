import { discordEmbed } from "../domain/discord";
import type { Env } from "./env";

interface PendingRow { incident_id:number; monitor_id:number; name:string; url:string; started_at:string; resolved_at:string|null; down_delivered_at:string|null; recovery_delivered_at:string|null; down_attempts:number; recovery_attempts:number; opening_error_code:string|null; opening_status_code:number|null; closing_latency_ms:number|null }
interface ClaimRow { id:number }

export function retryDelay(response:Response,attempts:number,now=Date.now()):number{
  const retry=response.headers.get("retry-after"); if(retry){const seconds=Number(retry);if(Number.isFinite(seconds))return Math.min(3600,Math.max(1,seconds));const date=Date.parse(retry);if(Number.isFinite(date))return Math.min(3600,Math.max(1,Math.ceil((date-now)/1000)));}
  return Math.min(3600,2**Math.min(attempts,10)*5);
}
function safeDeliveryError(response:Response):string{return `discord_http_${response.status}`;}
function webhookUrl(value:string):string{return `${value}${value.includes("?")?"&":"?"}wait=true`;}

export async function drainOneNotification(env:Env,fetcher:typeof fetch=fetch,clock:()=>Date=()=>new Date()):Promise<boolean>{
  if(!env.DISCORD_WEBHOOK_URL)return false;
  const nowDate=clock(); const now=nowDate.toISOString(); const claimedUntil=new Date(nowDate.valueOf()+30_000).toISOString();
  const row=await env.DB.prepare(`SELECT i.id incident_id,i.monitor_id,m.name,m.url,i.started_at,i.resolved_at,i.down_delivered_at,i.recovery_delivered_at,i.down_attempts,i.recovery_attempts
    ,opening.error_code opening_error_code,opening.status_code opening_status_code,closing.latency_ms closing_latency_ms
    FROM incidents i JOIN monitors m ON m.id=i.monitor_id LEFT JOIN checks opening ON opening.id=i.opening_check_id LEFT JOIN checks closing ON closing.id=i.closing_check_id WHERE
    (i.down_delivered_at IS NULL AND (i.down_next_attempt_at IS NULL OR unixepoch(i.down_next_attempt_at)<=?) AND (i.down_claimed_until IS NULL OR unixepoch(i.down_claimed_until)<=?)) OR
    (i.resolved_at IS NOT NULL AND i.down_delivered_at IS NOT NULL AND i.recovery_delivered_at IS NULL AND (i.recovery_next_attempt_at IS NULL OR unixepoch(i.recovery_next_attempt_at)<=?) AND (i.recovery_claimed_until IS NULL OR unixepoch(i.recovery_claimed_until)<=?))
    ORDER BY unixepoch(i.started_at),i.id LIMIT 1`).bind(Math.floor(nowDate.valueOf()/1000),Math.floor(nowDate.valueOf()/1000),Math.floor(nowDate.valueOf()/1000),Math.floor(nowDate.valueOf()/1000)).first<PendingRow>();
  if(!row)return false;
  const recovery=row.down_delivered_at!==null && row.resolved_at!==null;
  const prefix=recovery?"recovery":"down"; const token=crypto.randomUUID();
  const claimTime=Math.floor(nowDate.valueOf()/1000); const recoveryGuard=recovery?"AND resolved_at IS NOT NULL AND down_delivered_at IS NOT NULL":"";
  const claimed=await env.DB.prepare(`UPDATE incidents SET ${prefix}_claim_token=?,${prefix}_claimed_until=?,${prefix}_attempts=${prefix}_attempts+1 WHERE id=? AND ${prefix}_delivered_at IS NULL AND (${prefix}_next_attempt_at IS NULL OR unixepoch(${prefix}_next_attempt_at)<=?) AND (${prefix}_claimed_until IS NULL OR unixepoch(${prefix}_claimed_until)<=?) ${recoveryGuard} RETURNING id`).bind(token,claimedUntil,row.incident_id,claimTime,claimTime).first<ClaimRow>();
  if(!claimed)return false;
  const kind=recovery?"recovery":"down"; const at=recovery?(row.resolved_at??now):row.started_at;
  const detail=recovery?`Recovered in ${row.closing_latency_ms??0} ms`:row.opening_status_code!==null?`Failure: HTTP ${row.opening_status_code}`:`Failure: ${(row.opening_error_code??"network_error").replaceAll("_"," ")}`;
  let response:Response; const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),10_000);
  try { response=await fetcher(webhookUrl(env.DISCORD_WEBHOOK_URL),{method:"POST",signal:controller.signal,headers:{"content-type":"application/json"},body:JSON.stringify(discordEmbed({kind,name:row.name,hostname:new URL(row.url).hostname,at,dashboardUrl:`${env.DASHBOARD_URL.replace(/\/$/,"")}/?monitor=${row.monitor_id}`,detail}))}); }
  catch {
    const attempts=(recovery?row.recovery_attempts:row.down_attempts)+1; const next=new Date(nowDate.valueOf()+Math.min(3600,2**Math.min(attempts,10)*5)*1000).toISOString();
    await env.DB.prepare(`UPDATE incidents SET ${prefix}_next_attempt_at=?,${prefix}_error='discord_network_error',${prefix}_claim_token=NULL,${prefix}_claimed_until=NULL WHERE id=? AND ${prefix}_claim_token=?`).bind(next,row.incident_id,token).run(); return true;
  }finally{clearTimeout(timeout);}
  await response.body?.cancel();
  if(response.ok){ await env.DB.prepare(`UPDATE incidents SET ${prefix}_delivered_at=?,${prefix}_next_attempt_at=NULL,${prefix}_error=NULL,${prefix}_claim_token=NULL,${prefix}_claimed_until=NULL WHERE id=? AND ${prefix}_claim_token=?`).bind(now,row.incident_id,token).run(); return true; }
  const attempts=(recovery?row.recovery_attempts:row.down_attempts)+1; const next=new Date(nowDate.valueOf()+retryDelay(response,attempts,nowDate.valueOf())*1000).toISOString();
  await env.DB.prepare(`UPDATE incidents SET ${prefix}_next_attempt_at=?,${prefix}_error=?,${prefix}_claim_token=NULL,${prefix}_claimed_until=NULL WHERE id=? AND ${prefix}_claim_token=?`).bind(next,safeDeliveryError(response),row.incident_id,token).run();
  return true;
}

export async function sendTestNotification(env:Env,fetcher:typeof fetch=fetch):Promise<boolean>{
  if(!env.DISCORD_WEBHOOK_URL)return false;
  try{const response=await fetcher(webhookUrl(env.DISCORD_WEBHOOK_URL),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(discordEmbed({kind:"test",name:"Uptime monitor",hostname:new URL(env.DASHBOARD_URL).hostname,at:new Date().toISOString(),dashboardUrl:env.DASHBOARD_URL,detail:"Your Discord integration is working."}))});await response.body?.cancel();return response.ok;}catch{return false;}
}
