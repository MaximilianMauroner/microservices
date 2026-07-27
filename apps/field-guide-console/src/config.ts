type SharedConfig = { port:number; agentApiToken:string; publicBaseUrl:string };
export type Config = SharedConfig & ({ backend:"sqlite"; sqlitePath:string; databaseUrl?:string; importOnStart:boolean; importAllowOverwrite:boolean } | { backend:"postgres"; databaseUrl:string });

export function loadConfig(env:NodeJS.ProcessEnv=process.env):Config {
  const get=(name:string)=>{const value=env[name]?.trim();if(!value)throw new Error(`Missing required environment variable: ${name}`);return value;};
  const publicBaseUrl=parsePublicBaseUrl(get("PUBLIC_BASE_URL"));
  const port=env.PORT?Number(env.PORT):3000;
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error("PORT must be a valid port");
  const shared={port,agentApiToken:get("AGENT_API_TOKEN"),publicBaseUrl};
  const backend=env.DATABASE_BACKEND?.trim()||"sqlite";
  if(backend==="postgres")return {...shared,backend,databaseUrl:get("DATABASE_URL")};
  if(backend!=="sqlite")throw new Error("DATABASE_BACKEND must be sqlite or postgres");
  const sqlitePath=get("SQLITE_PATH");
  if(!sqlitePath.startsWith("/"))throw new Error("SQLITE_PATH must be an absolute path");
  const databaseUrl=env.DATABASE_URL?.trim();
  const overwrite=env.FIELD_GUIDE_IMPORT_ALLOW_OVERWRITE;
  if(overwrite!==undefined&&overwrite.trim()!=="yes")throw new Error("FIELD_GUIDE_IMPORT_ALLOW_OVERWRITE must be exactly yes when set");
  return {...shared,backend,sqlitePath,...(databaseUrl?{databaseUrl}:{}),importOnStart:env.IMPORT_POSTGRES_ON_START==="true",importAllowOverwrite:overwrite!==undefined};
}
function parsePublicBaseUrl(value:string){let url:URL;try{url=new URL(value);}catch{throw new Error("PUBLIC_BASE_URL must be an HTTP(S) origin");}if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.pathname!=="/"||url.search||url.hash)throw new Error("PUBLIC_BASE_URL must be an HTTP(S) origin without credentials, path, query, or fragment");return url.origin;}
