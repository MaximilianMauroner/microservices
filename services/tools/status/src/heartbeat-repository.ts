import postgres, { type Sql } from "postgres";

export interface HeartbeatRepository { record(monitorId: string, seenAt: Date): Promise<void>; lastSeenAt(monitorId: string): Promise<Date | null>; close(): Promise<void>; }
export function createPostgresHeartbeatRepository(databaseUrl: string): HeartbeatRepository { return postgresHeartbeatRepository(postgres(databaseUrl, { max: 4 })); }
export function postgresHeartbeatRepository(sql: Sql): HeartbeatRepository {
  return {
    async record(monitorId, seenAt) { await sql`insert into tools.heartbeats (monitor_id, last_seen_at) values (${monitorId}, ${seenAt}) on conflict (monitor_id) do update set last_seen_at = excluded.last_seen_at`; },
    async lastSeenAt(monitorId) { const [row] = await sql<{ last_seen_at: Date }[]>`select last_seen_at from tools.heartbeats where monitor_id = ${monitorId}`; return row?.last_seen_at ?? null; },
    close: () => sql.end()
  };
}
