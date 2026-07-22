import { CheckError, normalizedError } from "./errors";
import { validateLiteralTarget } from "./ip";
import { normalizeMonitorUrl } from "./url";
import type { ErrorCode } from "../shared/contracts";

export interface CheckResult { success: boolean; statusCode: number | null; latencyMs: number; errorCode: ErrorCode | null; checkedAt: string }
export interface CheckerDependencies { fetcher: typeof fetch; now?: () => number; timeoutMs?: number }

export async function checkTarget(rawUrl: string, deps: CheckerDependencies): Promise<CheckResult> {
  const started = (deps.now ?? Date.now)();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 10_000);
  let statusCode: number | null = null;
  try {
    let url = new URL(normalizeMonitorUrl(rawUrl));
    for (let redirects = 0; redirects <= 1; redirects += 1) {
      validateLiteralTarget(url.hostname);
      const response = await deps.fetcher(url, { method: "GET", redirect: "manual", signal: controller.signal, headers: { "user-agent": "UptimeMonitor/1.0", accept: "*/*" } });
      statusCode = response.status;
      if (response.status >= 300 && response.status <= 399 && response.headers.has("location")) {
        void response.body?.cancel();
        if (redirects === 1) throw new CheckError("too_many_redirects", "More than one redirect");
        const location = response.headers.get("location") ?? "";
        if (location.length > 2048) throw new CheckError("network_error", "Redirect location is too long");
        url = new URL(normalizeMonitorUrl(new URL(location, url).toString()));
        continue;
      }
      await response.body?.cancel();
      const latencyMs = Math.max(0, (deps.now ?? Date.now)() - started);
      return { success: response.status >= 200 && response.status <= 399, statusCode: response.status, latencyMs, errorCode: response.status >= 400 ? "http_error" : null, checkedAt: new Date((deps.now ?? Date.now)()).toISOString() };
    }
    throw new CheckError("too_many_redirects", "More than one redirect");
  } catch (error) {
    return { success: false, statusCode, latencyMs: Math.max(0, (deps.now ?? Date.now)() - started), errorCode: normalizedError(error), checkedAt: new Date((deps.now ?? Date.now)()).toISOString() };
  } finally { clearTimeout(timer); }
}
