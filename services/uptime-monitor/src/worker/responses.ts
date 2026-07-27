import type { ApiError } from "../shared/contracts";
export function json(value:unknown,status=200):Response{return Response.json(value,{status,headers:{"cache-control":"no-store"}});}
export function problem(code:string,message:string,status:number):Response{return json({error:{code,message}} satisfies ApiError,status);}
