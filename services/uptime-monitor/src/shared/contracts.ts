export type MonitorStatus = "checking" | "up" | "down" | "paused";
export type ErrorCode = "blocked_address" | "timeout" | "network_error" | "too_many_redirects" | "http_error";

export interface MonitorSummary {
  id: number; name: string; url: string; hostname: string; enabled: boolean; status: MonitorStatus;
  latestLatencyMs: number | null; latestStatusCode: number | null; lastCheckedAt: string | null;
  uptime24h: number | null; uptime30d: number | null; scheduleSlot: number;
}
export interface MonitorListResponse { monitors: MonitorSummary[]; capacity: { used: number; limit: 40 }; discordConfigured: boolean }
export interface CheckRecord { id: string; checkedAt: string; success: boolean; statusCode: number | null; latencyMs: number; errorCode: ErrorCode | null }
export interface IncidentRecord { id: number; startedAt: string; resolvedAt: string | null; downDeliveredAt: string | null; recoveryDeliveredAt: string | null }
export interface HistoryResponse { uptime: number | null; checks: CheckRecord[]; nextCursor: string | null; incidents: IncidentRecord[]; buckets: Array<{ at: string; latencyMs: number | null; success: boolean }> }
export interface ApiError { error: { code: string; message: string } }
