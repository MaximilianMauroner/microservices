import {
  CheckError,
  normalizedCheckError,
  validatedMonitorUrl,
  validatedRedirectUrl,
  type CheckObservation
} from "@tools-platform/domain";

export interface ProbeOptions {
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  observationId: string;
  runId: string;
}

export async function probeTarget(
  rawUrl: string,
  options: ProbeOptions
): Promise<CheckObservation> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 10_000
  );
  let statusCode: number | null = null;

  try {
    let url = validatedMonitorUrl(rawUrl);
    for (let redirects = 0; redirects <= 1; redirects += 1) {
      const response = await fetcher(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "ToolsChecker/1.0",
          accept: "*/*"
        }
      });
      statusCode = response.status;
      if (
        response.status >= 300 &&
        response.status <= 399 &&
        response.headers.has("location")
      ) {
        await response.body?.cancel();
        statusCode = null;
        if (redirects === 1) {
          throw new CheckError("too_many_redirects", "More than one redirect");
        }
        url = validatedRedirectUrl(
          response.headers.get("location") ?? "",
          url
        );
        continue;
      }
      await response.body?.cancel();
      const success = response.status >= 200 && response.status <= 399;
      return observation({
        options,
        checkedAt: now(),
        started,
        success,
        statusCode: response.status,
        errorCode: success ? null : "http_error"
      });
    }
    throw new CheckError("too_many_redirects", "More than one redirect");
  } catch (error) {
    return observation({
      options,
      checkedAt: now(),
      started,
      success: false,
      statusCode,
      errorCode: normalizedCheckError(error)
    });
  } finally {
    clearTimeout(timer);
  }
}

function observation(input: {
  options: ProbeOptions;
  checkedAt: number;
  started: number;
  success: boolean;
  statusCode: number | null;
  errorCode: CheckObservation["errorCode"];
}): CheckObservation {
  return {
    id: input.options.observationId,
    runId: input.options.runId,
    checkedAt: new Date(input.checkedAt).toISOString(),
    success: input.success,
    statusCode: input.statusCode,
    latencyMs: Math.max(0, input.checkedAt - input.started),
    errorCode: input.errorCode
  };
}
