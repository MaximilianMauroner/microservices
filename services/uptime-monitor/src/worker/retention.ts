import type { Env } from "./env";
export async function runRetentionOnceDaily(env:Env,now=new Date()):Promise<boolean>{
  const day=now.toISOString().slice(0,10); const previous=await env.DB.prepare("SELECT completed_at FROM maintenance WHERE key='retention'").first<{completed_at:string}>();
  if(previous?.completed_at.startsWith(day))return false;
  await env.DB.batch([env.DB.prepare("DELETE FROM checks WHERE checked_at < datetime('now','-30 days')"),env.DB.prepare("INSERT INTO maintenance(key,completed_at) VALUES('retention',?) ON CONFLICT(key) DO UPDATE SET completed_at=excluded.completed_at").bind(now.toISOString()),env.DB.prepare("DELETE FROM rate_limits WHERE window_started_at < datetime('now','-1 day')")]); return true;
}
