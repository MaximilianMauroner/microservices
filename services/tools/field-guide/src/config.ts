export type Config = {
  agentApiToken: string;
  publicBaseUrl: string;
  databaseUrl: string;
  decisionRecordArchiveDays?: number;
};

export function loadConfig(env:NodeJS.ProcessEnv=process.env):Config {
  const get=(name:string)=>{const value=env[name]?.trim();if(!value)throw new Error(`Missing required environment variable: ${name}`);return value;};
  const publicBaseUrl=parsePublicBaseUrl(get("PUBLIC_BASE_URL"));
  const decisionRecordArchiveDays=env.DECISION_RECORD_ARCHIVE_DAYS?Number(env.DECISION_RECORD_ARCHIVE_DAYS):90;
  if(!Number.isInteger(decisionRecordArchiveDays)||decisionRecordArchiveDays<1||decisionRecordArchiveDays>3650)throw new Error("DECISION_RECORD_ARCHIVE_DAYS must be between 1 and 3650");
  return {
    agentApiToken:get("AGENT_API_TOKEN"),
    publicBaseUrl,
    databaseUrl:get("DATABASE_URL"),
    decisionRecordArchiveDays,
  };
}
function parsePublicBaseUrl(value:string){let url:URL;try{url=new URL(value);}catch{throw new Error("PUBLIC_BASE_URL must be an HTTP(S) origin");}if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.pathname!=="/"||url.search||url.hash)throw new Error("PUBLIC_BASE_URL must be an HTTP(S) origin without credentials, path, query, or fragment");return url.origin;}
