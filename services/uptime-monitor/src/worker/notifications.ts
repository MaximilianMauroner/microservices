import { discordEmbed } from "../domain/discord";
import type { Env } from "./env";

interface PendingRow { incident_id:number; monitor_id:number; name:string; url:string; started_at:string; resolved_at:string|null; down_delivered_at:string|null; recovery_delivered_at:string|null; down_attempts:number; recovery_attempts:number }

function retryDelay(response:Response,attempts:number):number{
  const retry=response.headers.get("retry-after"); if(retry){const seconds=Number(retry);if(Number.isFinite(seconds))return Math.min(3600,Math.max(1,seconds));}
  return Math.min(3600,2**Math.min(attempts,10)*5);
}
function safeDeliveryError(response:Response):string{return `discord_http_${response.status}`;}

export async function drainOneNotification(env:Env,fetcher:typeof fetch=fetch):Promise<boolean>{
  if(!env.DISCORD_WEBHOOK_URL)return false;
  const now=new Date().toISOString();
  const row=await env.DB.prepare(`SELECT i.id incident_id,i.monitor_id,m.name,m.url,i.started_at,i.resolved_at,i.down_delivered_at,i.recovery_delivered_at,i.down_attempts,i.recovery_attempts
    FROM incidents i JOIN monitors m ON m.id=i.monitor_id WHERE
    (i.down_delivered_at IS NULL AND (i.down_next_attempt_at IS NULL OR i.down_next_attempt_at<=?)) OR
    (i.resolved_at IS NOT NULL AND i.down_delivered_at IS NOT NULL AND i.recovery_delivered_at IS NULL AND (i.recovery_next_attempt_at IS NULL OR i.recovery_next_attempt_at<=?))
    ORDER BY i.started_at LIMIT 1`).bind(now,now).first<PendingRow>();
  if(!row)return false;
  const recovery=row.down_delivered_at!==null && row.resolved_at!==null;
  const kind=recovery?"recovery":"down"; const at=recovery?(row.resolved_at??now):row.started_at;
  let response:Response;
  try { response=await fetcher(`${env.DISCORD_WEBHOOK_URL}?wait=true`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(discordEmbed({kind,name:row.name,hostname:new URL(row.url).hostname,at,dashboardUrl:`${env.DASHBOARD_URL.replace(/\/$/,"")}/?monitor=${row.monitor_id}`}))}); }
  catch { response=new Response(null,{status:599}); }
  if(response.ok){ await env.DB.prepare(`UPDATE incidents SET ${recovery?"recovery_delivered_at":"down_delivered_at"}=?,${recovery?"recovery_attempts":"down_attempts"}=${recovery?"recovery_attempts":"down_attempts"}+1,${recovery?"recovery_error":"down_error"}=NULL WHERE id=?`).bind(now,row.incident_id).run(); return true; }
  const attempts=(recovery?row.recovery_attempts:row.down_attempts)+1; const next=new Date(Date.now()+retryDelay(response,attempts)*1000).toISOString();
  await env.DB.prepare(`UPDATE incidents SET ${recovery?"recovery_attempts":"down_attempts"}=?,${recovery?"recovery_next_attempt_at":"down_next_attempt_at"}=?,${recovery?"recovery_error":"down_error"}=? WHERE id=?`).bind(attempts,next,safeDeliveryError(response),row.incident_id).run();
  return true;
}

export async function sendTestNotification(env:Env,fetcher:typeof fetch=fetch):Promise<boolean>{
  if(!env.DISCORD_WEBHOOK_URL)return false;
  const response=await fetcher(`${env.DISCORD_WEBHOOK_URL}?wait=true`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(discordEmbed({kind:"test",name:"Uptime monitor",hostname:new URL(env.DASHBOARD_URL).hostname,at:new Date().toISOString(),dashboardUrl:env.DASHBOARD_URL,detail:"Your Discord integration is working."}))});
  return response.ok;
}
