import { describe,expect,it,vi } from "vitest";
import { checkTarget } from "../src/domain/check";
import { discordEmbed,safeMonitorName } from "../src/domain/discord";
import { isBlockedAddress,validateLiteralTarget } from "../src/domain/ip";
import { applyObservation } from "../src/domain/status";
import { uptimePercentage } from "../src/domain/uptime";
import { normalizeMonitorUrl } from "../src/domain/url";

describe("URL safety",()=>{
  it("normalizes hosts and fragments",()=>expect(normalizeMonitorUrl(" HTTPS://EXAMPLE.COM/path#x ")).toBe("https://example.com/path"));
  it.each(["ftp://example.com","https://user:pass@example.com","not a url"])("rejects %s",(url)=>expect(()=>normalizeMonitorUrl(url)).toThrow());
  it.each(["0.0.0.0","10.1.2.3","100.64.1.1","127.0.0.1","169.254.1.1","172.16.0.1","192.0.2.1","192.168.1.1","198.18.0.1","198.51.100.1","203.0.113.1","224.0.0.1","255.255.255.255","::","::1","::127.0.0.1","64:ff9b::7f00:1","64:ff9b::a00:1","64:ff9b:1::1","100::1","2002:7f00:1::","2002:a00:1::","fc00::1","fe80::1","ff02::1","2001:db8::1","3fff::1","5f00::1","::ffff:127.0.0.1"])("blocks reserved address %s",(ip)=>expect(isBlockedAddress(ip)).toBe(true));
  it.each(["1.1.1.1","8.8.8.8","2606:4700:4700::1111"])("permits public address %s",(ip)=>expect(isBlockedAddress(ip)).toBe(false));
  it("trusts hostnames but rejects direct unsafe literals",()=>{expect(()=>validateLiteralTarget("example.com")).not.toThrow();expect(()=>validateLiteralTarget("[2606:4700:4700::1111]")).not.toThrow();expect(()=>validateLiteralTarget("[::1]")).toThrowError(expect.objectContaining({code:"blocked_address"}));});
});
describe("HTTP checker",()=>{
  it("accepts one redirect while using only two HTTP requests",async()=>{const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null,{status:302,headers:{location:"https://www.example.com/final"}})).mockResolvedValueOnce(new Response(null,{status:204}));const result=await checkTarget("https://example.com",{fetcher});expect(result.success).toBe(true);expect(fetcher).toHaveBeenCalledTimes(2);});
  it("rejects a redirect to a private address",async()=>{const result=await checkTarget("https://example.com",{fetcher:async()=>new Response(null,{status:302,headers:{location:"http://127.0.0.1"}})});expect(result.errorCode).toBe("blocked_address");});
  it.each(["https://[64:ff9b::7f00:1]/","https://[2002:a00:1::]/"])("rejects translated direct target %s before fetch",async(url)=>{const fetcher=vi.fn<typeof fetch>();expect((await checkTarget(url,{fetcher})).errorCode).toBe("blocked_address");expect(fetcher).not.toHaveBeenCalled();});
  it.each(["https://[64:ff9b::a00:1]/","https://[2002:7f00:1::]/"])("rejects translated redirect %s",async(location)=>{const result=await checkTarget("https://example.com",{fetcher:async()=>new Response(null,{status:302,headers:{location}})});expect(result.errorCode).toBe("blocked_address");});
  it("rejects a second redirect",async()=>{const result=await checkTarget("https://example.com",{fetcher:async()=>new Response(null,{status:302,headers:{location:"https://example.com/again"}})});expect(result.errorCode).toBe("too_many_redirects");});
  it("uses one overall timeout across redirects",async()=>{let calls=0;const fetcher:typeof fetch=async(_input,init)=>{calls+=1;if(calls===1)return new Response(null,{status:302,headers:{location:"https://example.com/slow"}});return new Promise((_resolve,reject)=>init?.signal?.addEventListener("abort",()=>reject(new DOMException("aborted","AbortError"))));};const result=await checkTarget("https://example.com",{fetcher,timeoutMs:5});expect(result.errorCode).toBe("timeout");expect(calls).toBe(2);});
  it("permits a public bracketed IPv6 literal",async()=>{const fetcher=vi.fn<typeof fetch>(async()=>new Response(null,{status:200}));expect((await checkTarget("https://[2606:4700:4700::1111]/",{fetcher})).success).toBe(true);});
  it("cancels the response body after headers",async()=>{let cancelled=false;const stream=new ReadableStream({cancel(){cancelled=true;}});const result=await checkTarget("https://example.com",{fetcher:async()=>new Response(stream,{status:200})});expect(result.success).toBe(true);expect(cancelled).toBe(true);});
});
describe("state and delivery",()=>{
  it("requires two failures and recovers with one success",()=>{const first=applyObservation({status:"up",consecutiveFailures:0,openIncidentId:null},false);expect(first).toEqual({status:"checking",consecutiveFailures:1,transition:"none"});const second=applyObservation({status:first.status,consecutiveFailures:1,openIncidentId:null},false);expect(second.transition).toBe("down");expect(applyObservation({status:"down",consecutiveFailures:2,openIncidentId:9},true).transition).toBe("recovery");});
  it("calculates check-based uptime to two decimals",()=>expect(uptimePercentage([{success:true},{success:true},{success:false}])).toBe(66.67));
  it("returns no uptime without completed checks",()=>expect(uptimePercentage([])).toBeNull());
  it("sanitizes names and suppresses all mentions",()=>{const payload=discordEmbed({kind:"down",name:"@everyone **bad**\nname",hostname:"example.com",at:"2026-01-01T00:00:00Z",dashboardUrl:"https://status.example"});expect(payload.allowed_mentions).toEqual({parse:[]});expect(payload.embeds[0].description).not.toContain("@");expect(safeMonitorName("``")).toBe("Monitor");});
});
