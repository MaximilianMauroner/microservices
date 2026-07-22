import { authorize } from "./auth";
import { CheckError } from "../domain/errors";
import { createMonitor,deleteMonitor,getMonitor,history,listMonitors,rateLimit,updateMonitor } from "./db";
import { runMonitorCheck } from "./checker";
import { sendTestNotification } from "./notifications";
import { json,problem } from "./responses";
import { monitorInput,monitorPatch,requestJson } from "./validation";
import type { Env } from "./env";

function monitorRoute(path:string):{id:number;tail:string}|null{const match=path.match(/^\/api\/monitors\/(\d+)(\/history|\/check)?$/);if(!match)return null;return{id:Number(match[1]),tail:match[2]??""};}
function apiFailure(error:unknown):Response{
  if(error instanceof SyntaxError)return problem("invalid_json","Request body must contain valid JSON",400);
  if(error instanceof CheckError)return problem("invalid_url",error.message,400);
  const code=error instanceof Error?error.message:"internal_error";
  const messages:Record<string,string>={invalid_name:"Name must be 1–80 characters",invalid_body:"Request body must be an object",invalid_enabled:"Enabled must be true or false",empty_patch:"Provide a field to update",invalid_content_type:"Content-Type must be application/json"};
  if(code in messages)return problem(code,messages[code],400);
  if(code==="monitor_limit_reached")return problem(code,"All 40 monitor slots are full",409);
  if(code==="slot_conflict")return problem(code,"Monitor capacity changed; try again",409);
  if(/unique/i.test(code))return problem("duplicate_url","That URL is already monitored",409);
  return problem("internal_error","The request could not be completed",500);
}

export async function routeApi(request:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
  if(!await authorize(request,env))return problem("unauthorized","Cloudflare Access authentication is required",401);
  const url=new URL(request.url); const route=monitorRoute(url.pathname);
  try{
    if(request.method==="GET"&&url.pathname==="/api/monitors"){const monitors=await listMonitors(env.DB);return json({monitors,capacity:{used:monitors.length,limit:40},discordConfigured:Boolean(env.DISCORD_WEBHOOK_URL)});}
    if(request.method==="POST"&&url.pathname==="/api/monitors"){
      const input=monitorInput(await requestJson(request));
      const monitor=await createMonitor(env.DB,input.name,input.url);ctx.waitUntil(runMonitorCheck(env,monitor.id));return json(monitor,201);
    }
    if(route&&request.method==="PATCH"&&route.tail===""){const changed=await updateMonitor(env.DB,route.id,monitorPatch(await requestJson(request)));return changed?json(changed):problem("not_found","Monitor not found",404);}
    if(route&&request.method==="DELETE"&&route.tail==="")return await deleteMonitor(env.DB,route.id)?new Response(null,{status:204}):problem("not_found","Monitor not found",404);
    if(route&&request.method==="POST"&&route.tail==="/check"){
      const monitor=await getMonitor(env.DB,route.id);if(!monitor)return problem("not_found","Monitor not found",404);if(!monitor.enabled)return problem("monitor_paused","Resume the monitor before checking it",409);
      if(!await rateLimit(env.DB,`manual:${route.id}`,3,60))return problem("rate_limited","Wait before checking again",429);await runMonitorCheck(env,route.id);return json({ok:true},202);
    }
    if(route&&request.method==="GET"&&route.tail==="/history"){if(!await getMonitor(env.DB,route.id))return problem("not_found","Monitor not found",404);const window=url.searchParams.get("window");if(window!=="24h"&&window!=="30d")return problem("invalid_window","Window must be 24h or 30d",400);const cursor=url.searchParams.get("cursor")??undefined;if(cursor&&Number.isNaN(Date.parse(cursor)))return problem("invalid_cursor","Cursor must be an ISO timestamp",400);return json(await history(env.DB,route.id,window,cursor));}
    if(request.method==="POST"&&url.pathname==="/api/notifications/discord/test"){
      if(!env.DISCORD_WEBHOOK_URL)return problem("discord_not_configured","Configure the Worker secret first",409);if(!await rateLimit(env.DB,"discord:test",2,300))return problem("rate_limited","Wait before sending another test",429);return await sendTestNotification(env)?json({ok:true}):problem("discord_delivery_failed","Discord rejected the test notification",502);
    }
    return problem("not_found","Route not found",404);
  }catch(error){return apiFailure(error);}
}
