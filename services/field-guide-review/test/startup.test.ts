import { describe, expect, it, vi } from "vitest";
import { startServer } from "../src/server.js";
import { MemoryReviewRepository } from "../src/memory-repository.js";
import type { Config } from "../src/config.js";
const config:Config={backend:"sqlite",sqlitePath:"/tmp/not-used.sqlite",importOnStart:false,port:3000,agentApiToken:"token",allowedEmail:"owner@example.com",publicBaseUrl:"https://review.example"};
describe("startup readiness",()=>{
  it("does not bind before repository initialization",async()=>{let release:()=>void=()=>undefined;const ready=new Promise<void>(resolve=>{release=resolve;});const serve=vi.fn(()=>({stop:vi.fn()}));const pending=startServer({config,createRepository:async()=>{await ready;const repository=new MemoryReviewRepository();return {repository,checkpoint:vi.fn(),close:()=>repository.close()};},serve});expect(serve).not.toHaveBeenCalled();release();const running=await pending;expect(serve).toHaveBeenCalledOnce();await running.shutdown();});
  it("never binds when initialization fails",async()=>{const serve=vi.fn();await expect(startServer({config,createRepository:async()=>{throw new Error("migration failed");},serve:serve as typeof Bun.serve})).rejects.toThrow("migration failed");expect(serve).not.toHaveBeenCalled();});
});
