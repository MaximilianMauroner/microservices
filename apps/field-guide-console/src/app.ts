import type {
  AmendVerdictInput,
  Candidate,
  ReviewRepository,
  Scope,
  VerdictInput,
} from "./types.js";
import { ConflictError, ValidationError } from "./types.js";
import {
  PayloadTooLargeError,
  isJsonMediaType,
  jsonResponse,
  readJson,
  secureHeaders,
  textResponse,
  type Authenticator,
  type FetchHandler,
} from "./http.js";
import { reviewConsole, reviewSuiteStyles } from "./ui.js";

type ParsedBody = { json: boolean; value?: unknown };

export function createApp(options: {
  repository: ReviewRepository;
  agentAuth: Authenticator;
  reviewerAuth: Authenticator;
  publicBaseUrl: string;
  stylesheet?: BodyInit | Blob;
  now?: () => Date;
}): FetchHandler {
  const now = options.now ?? (() => new Date());
  const allowedOrigin = new URL(options.publicBaseUrl).origin;
  return async (request) => {
    const head = request.method === "HEAD";
    const method = head ? "GET" : request.method;
    let response: Response | undefined;
    try {
      const url = new URL(request.url);
      const parsedBody = await parseBody(request);
      const pathname = normalizePath(url.pathname);

      if (method === "GET" && routeIs(pathname, "/health"))
        response = jsonResponse({ ok: true });
      if (
        response === undefined &&
        method === "GET" &&
        (routeIs(pathname, "/review") ||
          routeIs(pathname, "/review/callback"))
      )
        response = reviewConsole();
      if (
        response === undefined &&
        method === "GET" &&
        routeIs(pathname, "/review.css")
      ) {
        response = new Response(options.stylesheet ?? "", {
          headers: secureHeaders({
            "Cache-Control": "public, max-age=300",
            "Content-Type": "text/css; charset=utf-8",
          }),
        });
      }
      if (
        response === undefined &&
        method === "GET" &&
        routeIs(pathname, "/review-suite.css")
      ) {
        response = new Response(reviewSuiteStyles, {
          headers: secureHeaders({
            "Cache-Control": "public, max-age=300",
            "Content-Type": "text/css; charset=utf-8",
          }),
        });
      }
      if (
        response === undefined &&
        method === "GET" &&
        routeIs(pathname, "/")
      )
        response = new Response(null, {
          status: 302,
          headers: secureHeaders({ Location: "/review" }),
        });

      if (response === undefined && isPrefix(pathname, "/api/agent")) {
        const auth = await options.agentAuth(request);
        response = auth.ok
          ? await handleAgent(
              request,
              method,
              pathname,
              url,
              parsedBody,
              options.repository,
              now,
            )
          : auth.response;
      }
      if (response === undefined && isPrefix(pathname, "/api/review")) {
        const auth = await options.reviewerAuth(request);
        response = auth.ok
          ? await handleReview(
              request,
              method,
              pathname,
              url,
              parsedBody,
              options.repository,
              now,
              allowedOrigin,
              auth.email ?? "system",
            )
          : auth.response;
      }
      if (response === undefined)
        response = url.pathname.toLowerCase().startsWith("/api/")
          ? notFoundJson()
          : textResponse("Route not found.", { status: 404 });
    } catch (error) {
      response = mapError(error);
    }
    return head ? headResponse(response) : response;
  };
}

async function handleAgent(
  request: Request,
  method: string,
  pathname: string,
  url: URL,
  body: ParsedBody,
  repository: ReviewRepository,
  now: () => Date,
) {
  if (method === "POST" && routeIs(pathname, "/api/agent/candidates")) {
    const parsed = parseCandidate(requireJson(body));
    const result = await repository.createCandidate(
      parsed.idempotencyKey,
      parsed.candidate,
    );
    return jsonResponse(
      { status: result },
      { status: result === "created" ? 201 : 200 },
    );
  }
  if (method === "GET" && routeIs(pathname, "/api/agent/decisions")) {
    const page = await repository.decisions(
      parseCursorQuery(singleQuery(url, "cursor")),
      parseLimit(singleQuery(url, "limit")),
    );
    return jsonResponse({ ...page, summary: await repository.summary(now()) });
  }
  if (method === "POST" && routeIs(pathname, "/api/agent/receipts")) {
    const value = record(requireJson(body));
    const key = text(value.idempotencyKey, "idempotencyKey", 128);
    const id = uuid(value.decisionId, "decisionId");
    const at = iso(value.appliedAt, "appliedAt");
    if (value.result !== "applied" && value.result !== "already_applied")
      throw new InputError("Invalid result.");
    const result = await repository.createReceipt(
      key,
      id,
      at,
      value.result,
    );
    return jsonResponse(
      { status: result },
      { status: result === "created" ? 201 : 200 },
    );
  }
  return notFoundJson();
}

async function handleReview(
  request: Request,
  method: string,
  pathname: string,
  url: URL,
  body: ParsedBody,
  repository: ReviewRepository,
  now: () => Date,
  allowedOrigin: string,
  reviewer: string,
) {
  if (method === "GET" && routeIs(pathname, "/api/review/queue")) {
    const scope = parseScope(singleQuery(url, "scope"));
    return jsonResponse({
      items: await repository.queue(scope, now()),
      summary: await repository.summary(now()),
    });
  }
  if (method === "GET" && routeIs(pathname, "/api/review/history")) {
    const page = await repository.history(
      parseCursorQuery(singleQuery(url, "cursor")),
      parseLimit(singleQuery(url, "limit")),
      parseScope(singleQuery(url, "scope")),
    );
    return jsonResponse({ ...page, summary: await repository.summary(now()) });
  }
  const mutation = pathname.match(
    /^\/api\/review\/candidates\/([^/]+)\/rounds\/([^/]+)\/(verdict|amendments|scope)$/i,
  );
  if (method === "POST" && mutation) {
    enforceOrigin(request, allowedOrigin);
    const candidateId = uuid(decodePath(mutation[1] ?? ""), "candidateId");
    const round = parseRound(decodePath(mutation[2] ?? ""));
    const operation = mutation[3]?.toLowerCase();
    if (operation === "verdict") {
      const decision = await repository.decide(
        candidateId,
        round,
        parseVerdict(requireJson(body)),
        now(),
        reviewer,
      );
      return jsonResponse({ decision }, { status: 201 });
    }
    if (operation === "scope") {
      const candidate = await repository.reassignScope(
        candidateId,
        round,
        parseScopeChange(requireJson(body)),
        now(),
        reviewer,
      );
      return jsonResponse({ candidate });
    }
    const decision = await repository.amendDecision(
      candidateId,
      round,
      parseAmendment(requireJson(body)),
      now(),
      reviewer,
    );
    return jsonResponse({ decision }, { status: 201 });
  }
  return notFoundJson();
}

async function parseBody(request: Request): Promise<ParsedBody> {
  if (!isJsonMediaType(request.headers.get("content-type")))
    return { json: false };
  return { json: true, value: await readJson(request) };
}

function requireJson(body: ParsedBody) {
  return body.value;
}

function enforceOrigin(request: Request, allowedOrigin: string) {
  if (request.headers.get("origin") !== allowedOrigin)
    throw new OriginError("Request origin is not allowed.");
}

function isPrefix(pathname: string, prefix: string) {
  const lower = pathname.toLowerCase();
  return lower === prefix || lower.startsWith(`${prefix}/`);
}

function routeIs(pathname: string, route: string) {
  return pathname.toLowerCase() === route;
}

function normalizePath(pathname: string) {
  return pathname.length > 1 &&
    pathname.endsWith("/") &&
    !pathname.endsWith("//")
    ? pathname.slice(0, -1)
    : pathname;
}

function headResponse(response: Response) {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function singleQuery(url: URL, name: string): string | undefined {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) throw new InputError(`Duplicate ${name}.`);
  return values[0];
}

function decodePath(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new InputError("Invalid path parameter.");
  }
}

function notFoundJson() {
  return jsonResponse(
    { error: "not_found", message: "Route not found." },
    { status: 404 },
  );
}

function mapError(error: unknown) {
  if (error instanceof ConflictError)
    return jsonResponse(
      { error: "conflict", message: error.message },
      { status: 409 },
    );
  if (error instanceof OriginError)
    return jsonResponse(
      { error: "origin_forbidden", message: error.message },
      { status: 403 },
    );
  if (error instanceof PayloadTooLargeError)
    return jsonResponse(
      { error: "payload_too_large", message: error.message },
      { status: 413 },
    );
  if (
    error instanceof InputError ||
    error instanceof ValidationError ||
    error instanceof SyntaxError
  )
    return jsonResponse(
      { error: "invalid_request", message: error.message },
      { status: 400 },
    );
  console.error(error);
  return jsonResponse(
    { error: "internal_error", message: "Request failed." },
    { status: 500 },
  );
}

class InputError extends Error {}
class OriginError extends Error {}

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new InputError("JSON object required.");
  return value as Record<string, unknown>;
};

const text = (value: unknown, name: string, max: number) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max
  )
    throw new InputError(`${name} is invalid.`);
  return value;
};

const iso = (value: unknown, name: string) => {
  const string = text(value, name, 64);
  if (!Number.isFinite(new Date(string).getTime()))
    throw new InputError(`${name} is invalid.`);
  return new Date(string).toISOString();
};

function parseCandidate(value: unknown) {
  const body = record(value);
  const candidateValue = record(body.candidate);
  const scope = candidateValue.scope;
  if (scope !== "project" && scope !== "global")
    throw new InputError("Invalid scope.");
  const foundProjectKey = candidateValue.foundProjectKey;
  const foundProjectDisplayName = candidateValue.foundProjectDisplayName;
  if (
    (foundProjectKey === undefined) !==
    (foundProjectDisplayName === undefined)
  )
    throw new InputError("Found project fields must be provided together.");
  if (
    scope === "global" &&
    (candidateValue.projectKey || candidateValue.projectDisplayName)
  )
    throw new InputError("Global candidates forbid project fields.");
  if (
    !Array.isArray(candidateValue.evidence) ||
    candidateValue.evidence.length < 1 ||
    candidateValue.evidence.length > 20
  )
    throw new InputError("Evidence is invalid.");
  const evidence = candidateValue.evidence.map((value) => {
    const item = record(value);
    if (!Array.isArray(item.commitHashes) || item.commitHashes.length > 20)
      throw new InputError("Commit hashes are invalid.");
    return {
      excerpt: text(item.excerpt, "excerpt", 2000),
      ...(item.sessionRef
        ? { sessionRef: text(item.sessionRef, "sessionRef", 256) }
        : {}),
      commitHashes: item.commitHashes.map((hash) =>
        text(hash, "commitHash", 64),
      ),
    };
  });
  const project = scope === "project"
    ? {
        projectKey: text(candidateValue.projectKey, "projectKey", 128),
        projectDisplayName: text(
          candidateValue.projectDisplayName,
          "projectDisplayName",
          256,
        ),
      }
    : undefined;
  const foundProject = foundProjectKey !== undefined
    ? {
        foundProjectKey: text(foundProjectKey, "foundProjectKey", 128),
        foundProjectDisplayName: text(
          foundProjectDisplayName,
          "foundProjectDisplayName",
          256,
        ),
      }
    : project
      ? {
          foundProjectKey: project.projectKey,
          foundProjectDisplayName: project.projectDisplayName,
        }
      : undefined;
  if (
    project &&
    foundProject &&
    (project.projectKey !== foundProject.foundProjectKey ||
      project.projectDisplayName !== foundProject.foundProjectDisplayName)
  )
    throw new InputError("Project and found project fields must match.");
  const candidate: Candidate = {
    candidateId: uuid(candidateValue.candidateId, "candidateId"),
    scope,
    ...project,
    ...foundProject,
    lessonKey: text(candidateValue.lessonKey, "lessonKey", 128),
    title: text(candidateValue.title, "title", 256),
    body: text(candidateValue.body, "body", 10_000),
    rationale: text(candidateValue.rationale, "rationale", 4000),
    evidence,
    createdAt: iso(candidateValue.createdAt, "createdAt"),
  };
  return {
    idempotencyKey: text(body.idempotencyKey, "idempotencyKey", 128),
    candidate,
  };
}

function parseScopeChange(value: unknown): Scope {
  const body = record(value);
  if (Object.keys(body).some((key) => key !== "scope"))
    throw new InputError("Scope body contains unknown fields.");
  const scope = body.scope;
  if (scope !== "project" && scope !== "global")
    throw new InputError("Invalid scope.");
  return scope;
}

function parseScope(value: unknown): Scope | undefined {
  if (value === undefined) return undefined;
  if (value !== "project" && value !== "global")
    throw new InputError("Invalid scope.");
  return value;
}

function parseCursorQuery(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new InputError("Invalid cursor.");
  return value;
}

function parseVerdict(value: unknown): VerdictInput {
  const body = verdictRecord(value, ["action", "deferUntil"]);
  return {
    action: text(body.action, "action", 32) as VerdictInput["action"],
    ...(body.deferUntil !== undefined
      ? { deferUntil: iso(body.deferUntil, "deferUntil") }
      : {}),
  };
}

function parseAmendment(value: unknown): AmendVerdictInput {
  const body = verdictRecord(value, [
    "expectedDecisionId",
    "action",
    "deferUntil",
  ]);
  return {
    expectedDecisionId: uuid(body.expectedDecisionId, "expectedDecisionId"),
    action: text(body.action, "action", 32) as VerdictInput["action"],
    ...(body.deferUntil !== undefined
      ? { deferUntil: iso(body.deferUntil, "deferUntil") }
      : {}),
  };
}

function verdictRecord(value: unknown, allowed: readonly string[]) {
  const body = record(value);
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new InputError("Verdict body contains unknown fields.");
  return body;
}

function parseRound(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value))
    throw new InputError("round must be a positive integer.");
  const round = Number(value);
  if (!Number.isSafeInteger(round))
    throw new InputError("round must be a positive integer.");
  return round;
}

function uuid(value: unknown, name: string) {
  const string = text(value, name, 36);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      string,
    )
  )
    throw new InputError(`${name} must be a UUID.`);
  return string;
}

function parseLimit(value: unknown) {
  if (value === undefined) return 50;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 100)
    throw new InputError("limit must be between 1 and 100.");
  return number;
}
