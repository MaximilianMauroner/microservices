import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";

export async function authorize(request:Request,env:Env):Promise<boolean>{
  if(env.ENVIRONMENT==="local")return true;
  const token=request.headers.get("cf-access-jwt-assertion"); if(!token)return false;
  try{
    const issuer=env.ACCESS_TEAM_DOMAIN.replace(/\/$/,"");
    await jwtVerify(token,createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),{issuer,audience:env.ACCESS_AUD}); return true;
  }catch{return false;}
}
