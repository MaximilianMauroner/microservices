import type { Env } from "./env";
export async function runRetentionOnceDaily(env:Env,now=new Date()):Promise<boolean>{
  const day=now.toISOString().slice(0,10); const previous=await env.DB.prepare("SELECT completed_at FROM maintenance WHERE key='retention'").first<{completed_at:string}>();
  if(previous?.completed_at.startsWith(day))return false;
  const checkCutoff=Math.floor(now.valueOf()/1000)-30*24*60*60; const rateCutoff=Math.floor(now.valueOf()/1000)-24*60*60;
  await env.DB.batch([env.DB.prepare("DELETE FROM checks WHERE unixepoch(checked_at) < ?").bind(checkCutoff),env.DB.prepare("INSERT INTO maintenance(key,completed_at) VALUES('retention',?) ON CONFLICT(key) DO UPDATE SET completed_at=excluded.completed_at").bind(now.toISOString()),env.DB.prepare("DELETE FROM rate_limits WHERE unixepoch(window_started_at) < ?").bind(rateCutoff)]); return true;
}
