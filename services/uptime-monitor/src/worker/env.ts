export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  DASHBOARD_URL: string;
  DISCORD_WEBHOOK_URL?: string;
}
