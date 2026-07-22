import { describe,expect,it,vi } from "vitest";
import { checkTarget } from "../src/domain/check";
import { discordEmbed,safeMonitorName } from "../src/domain/discord";
import { isBlockedAddress,validatePublicHost,type DnsResolver } from "../src/domain/ip";
import { applyObservation } from "../src/domain/status";
import { uptimePercentage } from "../src/domain/uptime";
import { normalizeMonitorUrl } from "../src/domain/url";

const publicDns:DnsResolver={resolve4:async()=>["93.184.216.34"],resolve6:async()=>[]};
describe("URL safety",()=>{
  it("normalizes hosts and fragments",()=>expect(normalizeMonitorUrl(" HTTPS://EXAMPLE.COM/path#x ")).toBe("https://example.com/path"));
  it.each(["ftp://example.com","https://user:pass@example.com","not a url"])("rejects %s",(url)=>expect(()=>normalizeMonitorUrl(url)).toThrow());
  it.each(["0.0.0.0","10.1.2.3","100.64.1.1","127.0.0.1","169.254.1.1","172.16.0.1","192.0.2.1","192.168.1.1","198.18.0.1","198.51.100.1","203.0.113.1","224.0.0.1","255.255.255.255","::","::1","fc00::1","fe80::1","ff02::1","2001:db8::1","::ffff:127.0.0.1"])("blocks reserved address %s",(ip)=>expect(isBlockedAddress(ip)).toBe(true));
  it.each(["1.1.1.1","8.8.8.8","2606:4700:4700::1111"])("permits public address %s",(ip)=>expect(isBlockedAddress(ip)).toBe(false));
  it("rejects when any DNS answer is private",async()=>expect(validatePublicHost("example.com",{resolve4:async()=>["93.184.216.34","10.0.0.1"],resolve6:async()=>[]})).rejects.toMatchObject({code:"blocked_address"}));
});
describe("HTTP checker",()=>{
  it("accepts one redirect after revalidating both targets",async()=>{const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null,{status:302,headers:{location:"https://www.example.com/final"}})).mockResolvedValueOnce(new Response(null,{status:204}));const resolver={resolve4:vi.fn(async()=>["93.184.216.34"]),resolve6:vi.fn(async()=>[])};const result=await checkTarget("https://example.com",{fetcher,resolver});expect(result.success).toBe(true);expect(fetcher).toHaveBeenCalledTimes(2);expect(resolver.resolve4).toHaveBeenCalledTimes(2);});
  it("rejects a redirect to a private address",async()=>{const result=await checkTarget("https://example.com",{fetcher:async()=>new Response(null,{status:302,headers:{location:"http://127.0.0.1"}}),resolver:publicDns});expect(result.errorCode).toBe("blocked_address");});
  it("rejects a second redirect",async()=>{const result=await checkTarget("https://example.com",{fetcher:async()=>new Response(null,{status:302,headers:{location:"https://example.com/again"}}),resolver:publicDns});expect(result.errorCode).toBe("too_many_redirects");});
  it("times out and normalizes the error",async()=>{const fetcher:typeof fetch=async(_input,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener("abort",()=>reject(new DOMException("aborted","AbortError"))));const result=await checkTarget("https://example.com",{fetcher,resolver:publicDns,timeoutMs:5});expect(result.errorCode).toBe("timeout");});
  it("cancels the response body after headers",async()=>{let cancelled=false;const stream=new ReadableStream({cancel(){cancelled=true;}});const result=await checkTarget("https://example.com",{fetcher:async()=>new Response(stream,{status:200}),resolver:publicDns});await Promise.resolve();expect(result.success).toBe(true);expect(cancelled).toBe(true);});
});
describe("state and delivery",()=>{
  it("requires two failures and recovers with one success",()=>{const first=applyObservation({status:"up",consecutiveFailures:0,openIncidentId:null},false);expect(first).toEqual({status:"checking",consecutiveFailures:1,transition:"none"});const second=applyObservation({status:first.status,consecutiveFailures:1,openIncidentId:null},false);expect(second.transition).toBe("down");expect(applyObservation({status:"down",consecutiveFailures:2,openIncidentId:9},true).transition).toBe("recovery");});
  it("calculates check-based uptime to two decimals",()=>expect(uptimePercentage([{success:true},{success:true},{success:false}])).toBe(66.67));
  it("returns no uptime without completed checks",()=>expect(uptimePercentage([])).toBeNull());
  it("sanitizes names and suppresses all mentions",()=>{const payload=discordEmbed({kind:"down",name:"@everyone **bad**\nname",hostname:"example.com",at:"2026-01-01T00:00:00Z",dashboardUrl:"https://status.example"});expect(payload.allowed_mentions).toEqual({parse:[]});expect(payload.embeds[0].description).not.toContain("@");expect(safeMonitorName("``")).toBe("Monitor");});
});
