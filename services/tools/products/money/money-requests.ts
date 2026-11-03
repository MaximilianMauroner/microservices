export async function moneyForm<Result>(url: string, form: FormData): Promise<Result> {
  return moneyFetch<Result>(url, { body: form });
}
export async function moneyJson<Result = { ok: true }>(
  url: string,
  value: Record<string, unknown>,
  method = "POST",
): Promise<Result> {
  return moneyFetch<Result>(url, {
    method,
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  });
}
async function moneyFetch<Result>(
  url: string,
  init: Pick<RequestInit, "body" | "headers" | "method">,
): Promise<Result> {
  const response = await fetch(url, { method: "POST", ...init });
  const body = (await response.json()) as { message?: unknown } | Result;
  if (!response.ok)
    throw new Error(
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : `Money request failed with status ${response.status}.`,
    );
  return body as Result;
}
export async function moneyGet<Result>(url: string): Promise<Result> {
  const response = await fetch(url);
  const body = (await response.json()) as { message?: unknown } | Result;
  if (!response.ok)
    throw new Error(
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : `Money request failed with status ${response.status}.`,
    );
  return body as Result;
}
export async function moneyDelete<Result = { ok: true }>(
  url: string,
): Promise<Result> {
  const response = await fetch(url, { method: "DELETE" });
  const body = (await response.json()) as { message?: unknown } | Result;
  if (!response.ok)
    throw new Error(
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : `Money request failed with status ${response.status}.`,
    );
  return body as Result;
}
