export type HttpMonitorDefinition = Readonly<{ id: string; kind: "http"; url: string; scope: "public" | "tailnet"; expectedStatus: readonly number[]; timeoutMs: number }>;
export type HeartbeatMonitorDefinition = Readonly<{ id: string; kind: "heartbeat"; scope: "public"; checkUrl: string; staleAfterMs: number }>;
export type MonitorDefinition = HttpMonitorDefinition | HeartbeatMonitorDefinition;

/** Monitor identity and expected behaviour live in code; Postgres only records runtime facts. */
export function loadMonitorDefinitions(env: Readonly<Record<string, string | undefined>> = process.env) {
  const origin = requiredOrigin(env.PUBLIC_ORIGIN, "PUBLIC_ORIGIN");
  return [
    http("tools-directory", `${origin}/health/tools`),
    http("artifact-publisher", `${origin}/health/publisher`),
    http("field-guide-console", `${origin}/health/review`),
    http("markdown-share", requiredOrigin(env.MARKDOWN_SHARE_PUBLIC_ORIGIN, "MARKDOWN_SHARE_PUBLIC_ORIGIN")),
    { id: "network-console", kind: "http", url: "https://coding.tailbc92d.ts.net/health", scope: "tailnet", expectedStatus: [200], timeoutMs: 10_000 },
    http("home-assistant", "https://homeassistant.mauroner.net/"),
    { id: "tower", kind: "heartbeat", scope: "public", checkUrl: `${origin}/health/tower`, staleAfterMs: positiveInteger(env.TOWER_HEARTBEAT_STALE_AFTER_MS, 40 * 60_000) }
  ] as const satisfies readonly MonitorDefinition[];
}

export function assertMonitorIdentities(
  catalogIds: readonly string[],
  productMonitorIds: readonly string[],
  definitions: readonly MonitorDefinition[]
) {
  const definitionIds = new Set(definitions.map(({ id }) => id));
  const duplicates = definitions.filter((definition, index) => definitions.findIndex(({ id }) => id === definition.id) !== index).map(({ id }) => id);
  const missingCatalog = definitions.filter(({ id }) => !catalogIds.includes(id)).map(({ id }) => id);
  const extraCatalog = catalogIds.filter((id) => !definitionIds.has(id));
  const unknownProducts = productMonitorIds.filter((id) => !definitionIds.has(id));
  if (duplicates.length || missingCatalog.length || extraCatalog.length || unknownProducts.length) {
    throw new Error(`Invalid monitor identities: duplicates=${duplicates.join(",")}; missingCatalog=${missingCatalog.join(",")}; extraCatalog=${extraCatalog.join(",")}; unknownProducts=${unknownProducts.join(",")}`);
  }
}

function http(id: string, url: string): HttpMonitorDefinition { return { id, kind: "http", url, scope: "public", expectedStatus: [200], timeoutMs: 10_000 }; }
function requiredOrigin(value: string | undefined, name: string) {
  if (!value?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error(`${name} must be an HTTP(S) URL`);
  return url.origin;
}
function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("Heartbeat staleness must be a positive integer");
  return parsed;
}
