/** Sends one rule request to a Money API route and returns its JSON body, or throws the route's message. */
export async function ruleRequest<Result = { ok: true }>(url: string, value: Record<string, unknown>, init: Readonly<{ method?: string; signal?: AbortSignal }> = {}): Promise<Result> {
  const response = await fetch(url, { method: init.method ?? "POST", body: JSON.stringify(value), headers: { "Content-Type": "application/json" }, signal: init.signal });
  const body = (await response.json()) as { message?: unknown } | Result;
  if (!response.ok) {
    throw new Error(typeof (body as { message?: unknown }).message === "string" ? (body as { message: string }).message : `Rule request failed with status ${response.status}.`);
  }
  return body as Result;
}

export function ruleErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The rule request failed.";
}
