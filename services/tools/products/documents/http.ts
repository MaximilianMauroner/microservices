import type { createMarkdownShareRepository } from "./repository.js";
import type { createDocumentChanges } from "./changes.js";
import { ShareError } from "./types.js";
import { readBoundedBody, RequestBodyTooLargeError } from "../../platform/request-body.js";
import { clientAddress, createRateLimit } from "../../platform/security/rate-limit.js";

type Repository = ReturnType<typeof createMarkdownShareRepository>;
type Changes = ReturnType<typeof createDocumentChanges>;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const CREATES_PER_HOUR = 30;
const TOKEN_PATTERN = /^(?:[a-z0-9]{20,64}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

/** `creator` names the owner of a new document. Every other operation needs only the capability link. */
export function createShareHandler(repository: Repository, changes: Changes, publicOrigin: string, creator: (request: Request) => Promise<string>) {
  const allowCreate = createRateLimit({ limit: CREATES_PER_HOUR, windowMs: 60 * 60 * 1000 });
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const parts = url.pathname.slice("/api/share/documents".length).split("/").filter(Boolean);
      const [token, ...actionParts] = parts;
      const action = actionParts.join("/");
      if (request.method === "POST") {
        if (request.headers.get("Origin") !== publicOrigin || request.headers.get("Sec-Fetch-Site") === "cross-site") {
          return json({ error: { code: "FORBIDDEN", message: "Use the document's own site to make changes." } }, 403);
        }
        if (request.headers.get("Content-Type")?.split(";")[0]?.trim() !== "application/json") {
          return json({ error: { code: "INVALID_REQUEST", message: "Send a JSON request." } }, 415);
        }
      }
      if (!token && request.method === "POST") {
        if (!allowCreate(clientAddress(request))) {
          return json({ error: { code: "RATE_LIMITED", message: "Too many new documents from this network. Try again in an hour." } }, 429);
        }
        const body = await readBody(request);
        const format = text(body, "format");
        if (format !== "markdown" && format !== "latex") throw invalid("Unknown document format.");
        return json(await repository.create({ requestId: text(body, "requestId"), filename: text(body, "filename"), format, markdown: text(body, "markdown") }, await creator(request)));
      }
      if (!token || !TOKEN_PATTERN.test(token)) return json({ error: { code: "DOCUMENT_UNAVAILABLE", message: "This link is unavailable." } }, 404);
      if (request.method === "GET") {
        switch (action) {
          case "": return json(await repository.open(token));
          case "updates": {
            const version = Number(url.searchParams.get("version"));
            if (!url.searchParams.has("version") || !Number.isSafeInteger(version) || version < 0) throw invalid("Invalid editor version.");
            const subscription = changes.subscribe(token, request.signal);
            try {
              await subscription.ready;
              const initial = await repository.updates(token, version);
              if (initial.steps.length > 0 || url.searchParams.get("wait") === "0") return json(initial);
              await subscription.promise;
              if (request.signal.aborted) return new Response(null, { status: 499 });
              return json(await repository.updates(token, version));
            } finally {
              subscription.cancel();
            }
          }
          case "checkpoints/compare": return json(await repository.compare(token, url.searchParams.get("olderId") ?? "", url.searchParams.get("newerId") ?? ""));
        }
      }
      if (request.method === "POST") {
        const body = await readBody(request);
        switch (action) {
          case "steps": {
            if (!Array.isArray(body.steps)) throw invalid("Editor steps must be an array.");
            return json(await repository.submit(token, { version: integer(body, "version"), clientId: text(body, "clientId"), steps: body.steps }));
          }
          case "pin": {
            if (typeof body.pinned !== "boolean") throw invalid("Pinned must be a boolean.");
            return json(await repository.setPinned(token, body.pinned));
          }
          case "checkpoints": return json(await repository.checkpoint(token, text(body, "createdBy")));
          case "presence": {
            await repository.touch(token, { sessionId: text(body, "sessionId"), userId: text(body, "userId"), name: text(body, "name") });
            return json(null);
          }
          case "leave": await repository.leave(token, text(body, "sessionId")); return json(null);
        }
      }
      return json({ error: { code: "METHOD_NOT_ALLOWED", message: "This operation is unavailable." } }, 405);
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: 499 });
      if (error instanceof ShareError) {
        return json({ error: error.data }, error.data.code === "DOCUMENT_UNAVAILABLE" ? 404 : 400);
      }
      console.error(JSON.stringify({ event: "markdown_share.request_failed", errorType: error instanceof Error ? error.name : "UnknownError" }));
      return json({ error: { code: "SERVICE_UNAVAILABLE", message: "Document sync is temporarily unavailable. Your browser will retry." } }, 503);
    }
  };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff",
  } });
}
function invalid(message: string) { return new ShareError("INVALID_EDITOR_PAYLOAD", message); }
function text(body: Record<string, unknown>, name: string): string {
  if (typeof body[name] !== "string") throw invalid(`Missing or invalid ${name}.`);
  return body[name];
}
function integer(body: Record<string, unknown>, name: string): number {
  const value = body[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalid(`Invalid ${name}.`);
  return value;
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  let bytes: Uint8Array | undefined;
  try {
    bytes = await readBoundedBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw new ShareError("DOCUMENT_TOO_LARGE", "The save request exceeds the size limit.");
    throw error;
  }
  if (!bytes) throw invalid("A JSON body is required.");
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw invalid("The request is not valid JSON."); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid("The request must be a JSON object.");
  return value as Record<string, unknown>;
}
