import { normalizeMonitorUrl } from "../domain/url";

export interface MonitorInput { name:string; url:string }
export interface MonitorPatch { name?:string; url?:string; enabled?:boolean }
function record(value:unknown):Record<string,unknown>|null{return typeof value==="object"&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:null;}
function name(value:unknown):string{if(typeof value!=="string"||!value.trim()||value.trim().length>80)throw new Error("invalid_name");return value.trim();}
export function monitorInput(value:unknown):MonitorInput{const body=record(value);if(!body)throw new Error("invalid_body");return{name:name(body.name),url:normalizeMonitorUrl(typeof body.url==="string"?body.url:"")};}
export function monitorPatch(value:unknown):MonitorPatch{const body=record(value);if(!body)throw new Error("invalid_body");const result:MonitorPatch={};if("name" in body)result.name=name(body.name);if("url" in body)result.url=normalizeMonitorUrl(typeof body.url==="string"?body.url:"");if("enabled" in body){if(typeof body.enabled!=="boolean")throw new Error("invalid_enabled");result.enabled=body.enabled;}if(!Object.keys(result).length)throw new Error("empty_patch");return result;}
export async function requestJson(request:Request):Promise<unknown>{if(!request.headers.get("content-type")?.toLowerCase().includes("application/json"))throw new Error("invalid_content_type");return request.json();}
