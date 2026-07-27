import { routeApi } from "./router";
import { runScheduled } from "./scheduler";
import type { Env } from "./env";

export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response>{const url=new URL(request.url);return url.pathname.startsWith("/api/")?routeApi(request,env,ctx):env.ASSETS.fetch(request);},
  async scheduled(controller:ScheduledController,env:Env,ctx:ExecutionContext):Promise<void>{ctx.waitUntil(runScheduled(env,new Date(controller.scheduledTime)));},
} satisfies ExportedHandler<Env>;
