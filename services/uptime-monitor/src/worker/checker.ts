import { resolve4, resolve6 } from "node:dns/promises";
import { checkTarget, type CheckerDependencies } from "../domain/check";
import { getMonitor, recordObservation } from "./db";
import type { Env } from "./env";

const resolver: CheckerDependencies["resolver"] = { resolve4, resolve6 };

export async function runMonitorCheck(env:Env,id:number,deps:CheckerDependencies={fetcher:fetch,resolver}):Promise<void>{
  for(let attempt=0;attempt<2;attempt+=1){
    const monitor=await getMonitor(env.DB,id); if(!monitor||monitor.enabled===0)return;
    const result=await checkTarget(monitor.url,deps);
    if(await recordObservation(env.DB,monitor,result))return;
  }
}
