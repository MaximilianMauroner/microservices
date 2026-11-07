import type { PlatformPrincipal } from "#security";
import { readBoundedBody, RequestBodyTooLargeError } from "../request-body.js";
import { clientAddress, createRateLimit } from "../security/rate-limit.js";
import type { DevFeedbackRepository } from "./dev-feedback.js";
import { parseDevFeedback } from "./report.js";

const MAX_BODY_BYTES = 16 * 1024;
const TEN_MINUTES = 10 * 60 * 1000;
const allowSignedIn = createRateLimit({ limit: 20, windowMs: TEN_MINUTES });
const allowAnonymous = createRateLimit({ limit: 5, windowMs: TEN_MINUTES });

function reply(status: number, body: Record<string, unknown>, headers?: Record<string, string>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/**
 * Takes a bug report or an idea from a native app, such as Pantrino or Dotally. With the app's bearer token the report names its sender.
 * Without one it is anonymous and rate limited per address. A browser page cannot send JSON here, because it gets no CORS answer.
 */
export async function handleReportSubmission(request: Request, resolveAppToken: (request: Request) => Promise<PlatformPrincipal | undefined>, reports: DevFeedbackRepository) {
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) return reply(415, { error: "unsupported_media_type" });
  const principal = request.headers.has("authorization") ? await resolveAppToken(request) : undefined;
  if (request.headers.has("authorization") && !principal) return reply(401, { error: "invalid_token" }, { "WWW-Authenticate": "Bearer" });
  if (!(principal ? allowSignedIn(principal.subject) : allowAnonymous(clientAddress(request)))) return reply(429, { error: "rate_limited" }, { "Retry-After": "600" });

  let body: Record<string, unknown>;
  try {
    const bytes = await readBoundedBody(request, MAX_BODY_BYTES);
    const parsed: unknown = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : undefined;
    if (!parsed || typeof parsed !== "object") return reply(400, { error: "invalid_request" });
    body = parsed as Record<string, unknown>;
  } catch (error) {
    return error instanceof RequestBodyTooLargeError ? reply(413, { error: "request_too_large" }) : reply(400, { error: "invalid_request" });
  }

  let input;
  try {
    input = parseDevFeedback({ app: body.app, kind: body.kind, message: body.message, details: body.details, page: body.page, context: body.context, contactEmail: principal ? undefined : body.contactEmail });
  } catch (error) {
    return reply(400, { error: "invalid_request", message: error instanceof Error ? error.message : "Invalid report." });
  }
  await reports.send(input, principal ? { subject: principal.subject, email: principal.email } : undefined);
  return reply(201, { ok: true });
}
