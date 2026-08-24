import type { PlatformRouteInput } from "../src/route-handlers.js";
import { FeedbackValidationError, feedbackLocale, localizeFeedbackForm, validateFeedbackAnswers } from "./domain.js";

const MAXIMUM_BODY_BYTES = 32 * 1024;

export async function submitPublicFeedback({ request, context, params }: PlatformRouteInput) {
  const origin = request.headers.get("origin");
  const sameOriginBrowserPost = request.headers.get("sec-fetch-site") === "same-origin";
  if (!sameOriginBrowserPost && (!origin || !requestOrigins(request, context.runtime.publicOrigin).has(origin))) return json({ error: "invalid_origin" }, 403);
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) return json({ error: "invalid_content_type" }, 415);
  try {
    const body = await boundedBody(request);
    const fields = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(body));
    const locale = feedbackLocale(new URL(request.url).searchParams.get("lang") ?? undefined);
    if (fields.get("website")) return redirectToForm(params.token, locale, true);
    const form = await context.runtime.feedback.getPublicForm(params.token);
    if (!form) return notFound();
    const entries: Record<string, FormDataEntryValue> = {};
    for (const [key, value] of fields) entries[key] = value;
    const answers = validateFeedbackAnswers(form.questions, entries);
    const localized = localizeFeedbackForm(form, locale);
    await context.runtime.feedback.createSubmission(form, answers, localized.questions);
    return redirectToForm(params.token, locale, true);
  } catch (error) {
    const locale = feedbackLocale(new URL(request.url).searchParams.get("lang") ?? undefined);
    if (error instanceof FeedbackValidationError) return redirectToForm(params.token, locale, false, error.code);
    if (error instanceof RequestTooLargeError) return json({ error: "request_too_large" }, 413);
    return json({ error: "invalid_request" }, 400);
  }
}

function requestOrigins(request: Request, publicOrigin: string) {
  const requestUrl = new URL(request.url);
  const origins = new Set([requestUrl.origin, new URL(publicOrigin).origin]);
  const host = firstForwardedValue(request.headers.get("x-forwarded-host")) ?? request.headers.get("host");
  const protocol = firstForwardedValue(request.headers.get("x-forwarded-proto")) ?? requestUrl.protocol.slice(0, -1);
  if (host && (protocol === "http" || protocol === "https")) {
    try { origins.add(new URL(`${protocol}://${host}`).origin); } catch { /* Ignore malformed proxy headers. */ }
  }
  return origins;
}

function firstForwardedValue(value: string | null) { return value?.split(",", 1)[0]?.trim() || undefined; }

function redirectToForm(token: string, locale: string, submitted: boolean, error?: string) {
  const query = new URLSearchParams({ lang: locale, ...(submitted ? { submitted: "1" } : { error: error ?? "invalid_request" }) });
  return new Response(null, { status: 303, headers: { "Cache-Control": "no-store", Location: `/feedback/f/${encodeURIComponent(token)}?${query}` } });
}
function notFound() { return new Response("Feedback form not found.", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } }); }
function json(body: unknown, status: number) { return new Response(JSON.stringify(body), { status, headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } }); }
class RequestTooLargeError extends Error {}
async function boundedBody(request: Request) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAXIMUM_BODY_BYTES)) throw new RequestTooLargeError();
  const reader = request.body?.getReader();
  if (!reader) throw new FeedbackValidationError("invalid_request", "The request body is missing.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAXIMUM_BODY_BYTES) { await reader.cancel(); throw new RequestTooLargeError(); }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}
