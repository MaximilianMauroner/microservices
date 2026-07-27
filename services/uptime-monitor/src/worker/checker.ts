import { checkTarget, type CheckerDependencies } from "../domain/check";
import { getMonitor, recordObservation } from "./db";
import type { Env } from "./env";

export const MAX_OBSERVATION_ATTEMPTS=16;
export async function runMonitorCheck(env:Env,id:number,deps:CheckerDependencies={fetcher:fetch}):Promise<void>{
  let monitor=await getMonitor(env.DB,id); if(!monitor||monitor.enabled===0)return;
  const result=await checkTarget(monitor.url,deps);
  const checkId=crypto.randomUUID();
  for(let attempt=0;attempt<MAX_OBSERVATION_ATTEMPTS;attempt+=1){
    if(await recordObservation(env.DB,monitor,result,checkId))return;
    monitor=await getMonitor(env.DB,id); if(!monitor||monitor.enabled===0)return;
  }
  throw new Error("observation_retry_exhausted");
}
