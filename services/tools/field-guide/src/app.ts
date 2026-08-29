import type {
  AmendVerdictInput,
  Candidate,
  DecisionFeedbackInput,
  DecisionRecord,
  DecisionRecordFilters,
  ReviewRepository,
  Scope,
  VerdictInput,
} from "./types.js";
import { ConflictError, NotFoundError, ValidationError } from "./types.js";
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
import { containsPrivateUrl } from "./private-url-policy.js";

type ParsedBody = { json: boolean; value?: unknown };

export function createApp(options: {
  repository: ReviewRepository;
  agentAuth: Authenticator;
  reviewerAuth: Authenticator;
  publicBaseUrl: string;
  browserUi?: boolean;
  stylesheet?: BodyInit | Blob;
  decisionRecordArchiveDays?: number;
  decisionRecordRateLimitPerMinute?: number;
  now?: () => Date;
}): FetchHandler {
  const now = options.now ?? (() => new Date());
  const consumeDecisionRecord = rateLimiter(options.decisionRecordRateLimitPerMinute ?? 120, now);
  const allowedOrigin = new URL(options.publicBaseUrl).origin;
  return async (request) => {
    const head = request.method === "HEAD";
    const method = head ? "GET" : request.method;
    let response: Response | undefined;
    try {
      const url = new URL(request.url);
      const parsedBody = await parseBody(request);
      const pathname = normalizePath(url.pathname);
      const browserUi = options.browserUi !== false;

      if (method === "GET" && routeIs(pathname, "/health"))
        response = jsonResponse({ ok: true });
      if (
        response === undefined &&
        !browserUi &&
        (routeIs(pathname, "/") ||
          isPrefix(pathname, "/review") ||
          routeIs(pathname, "/review.css") ||
          routeIs(pathname, "/review-suite.css") ||
          isPrefix(pathname, "/api/review"))
      )
        response = textResponse(
          "The review browser is available only through the unified Mauroner Tools service.",
          { status: 503 },
        );
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
              consumeDecisionRecord,
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
              options.decisionRecordArchiveDays ?? 90,
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
  consumeDecisionRecord: () => void,
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
  if (method === "POST" && routeIs(pathname, "/api/agent/decision-records")) {
    consumeDecisionRecord();
    const parsed = parseDecisionRecord(requireJson(body));
    const result = await repository.createDecisionRecord(
      parsed.idempotencyKey,
      parsed.record,
    );
    return jsonResponse(
      { status: result, decisionRecordId: parsed.record.decisionRecordId },
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
  decisionRecordArchiveDays: number,
) {
  if (method === "GET" && routeIs(pathname, "/api/review/decision-records")) {
    return jsonResponse(await repository.decisionRecords(parseDecisionRecordFilters(url, now(), decisionRecordArchiveDays)));
  }
  if (method === "POST" && routeIs(pathname, "/api/review/decision-records/promotions")) {
    enforceOrigin(request, allowedOrigin);
    const parsed = await parseDecisionPromotion(requireJson(body), repository, now(), decisionRecordArchiveDays);
    const result = await repository.promoteDecisionRecords(
      parsed.idempotencyKey,
      parsed.decisionRecordIds,
      parsed.candidate,
      now(),
      reviewer,
    );
    return jsonResponse(result, { status: result.status === "created" ? 201 : 200 });
  }
  const decisionRecordRoute = pathname.match(
    /^\/api\/review\/decision-records\/([^/]+)(?:\/(feedback))?$/i,
  );
  if (decisionRecordRoute) {
    const decisionRecordId = uuid(decodePath(decisionRecordRoute[1] ?? ""), "decisionRecordId");
    if (method === "GET" && !decisionRecordRoute[2])
      return jsonResponse(await repository.decisionRecord(decisionRecordId, now(), decisionRecordArchiveDays));
    if (method === "POST" && decisionRecordRoute[2]) {
      enforceOrigin(request, allowedOrigin);
      const feedback = await repository.addDecisionFeedback(
        decisionRecordId,
        parseDecisionFeedback(requireJson(body)),
        now(),
        reviewer,
      );
      return jsonResponse({ feedback }, { status: 201 });
    }
  }
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
  if (error instanceof NotFoundError)
    return jsonResponse(
      { error: "not_found", message: error.message },
      { status: 404 },
    );
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
  if (error instanceof RateLimitError)
    return jsonResponse(
      { error: "rate_limited", message: error.message },
      { status: 429, headers: { "Retry-After": "60" } },
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
class RateLimitError extends Error {}

function rateLimiter(limit: number, now: () => Date) {
  const timestamps: number[] = [];
  return () => {
    const current = now().getTime();
    while (timestamps[0] !== undefined && timestamps[0] <= current - 60_000)
      timestamps.shift();
    if (timestamps.length >= limit)
      throw new RateLimitError("Decision record ingestion rate limit exceeded.");
    timestamps.push(current);
  };
}

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

const preventionLayers = ["architecture", "automated_check", "skill_or_rule", "human_review"] as const;
const lessonStances = ["prohibition", "rule", "preference", "default"] as const;
const lessonStrengths = ["blocking", "advisory"] as const;

function parseLessonEnforcement(value: Record<string, unknown>) {
  const stance = value.stance;
  if (stance !== undefined && !lessonStances.includes(stance as typeof lessonStances[number]))
    throw new InputError("stance is invalid.");
  const strength = value.strength;
  if (strength !== undefined && !lessonStrengths.includes(strength as typeof lessonStrengths[number]))
    throw new InputError("strength is invalid.");
  const mechanism = value.mechanism === undefined
    ? undefined
    : text(value.mechanism, "mechanism", 512);
  const preventionLayer = value.preventionLayer;
  if (preventionLayer !== undefined && !preventionLayers.includes(preventionLayer as typeof preventionLayers[number]))
    throw new InputError("preventionLayer is invalid.");
  if (strength === "blocking" && mechanism === undefined)
    throw new InputError("Blocking guidance requires a mechanism.");
  if (preventionLayer !== undefined) {
    const expectedStrength = preventionLayer === "architecture" || preventionLayer === "automated_check"
      ? "blocking"
      : "advisory";
    if (strength !== expectedStrength)
      throw new InputError(`${preventionLayer} requires ${expectedStrength} strength.`);
    if (mechanism === undefined)
      throw new InputError("A prevention layer requires a mechanism.");
  }
  const failedInvariant = value.failedInvariant === undefined
    ? undefined
    : text(value.failedInvariant, "failedInvariant", 1000);
  const rejectionValue = value.higherLevelRejections === undefined
    ? undefined
    : record(value.higherLevelRejections);
  const expectedRejectionLayers = preventionLayer === undefined
    ? []
    : preventionLayers.slice(0, preventionLayers.indexOf(preventionLayer as typeof preventionLayers[number]));
  const rejectionKeys = Object.keys(rejectionValue ?? {});
  if (
    rejectionKeys.length !== expectedRejectionLayers.length ||
    rejectionKeys.some((key) => !expectedRejectionLayers.includes(key as typeof preventionLayers[number]))
  ) throw new InputError("higherLevelRejections must explain every stronger prevention layer and no others.");
  const higherLevelRejections = rejectionValue
    ? Object.fromEntries(expectedRejectionLayers.map((layer) => [
        layer,
        text(rejectionValue[layer], `higherLevelRejections.${layer}`, 1000),
      ]))
    : undefined;
  return {
    ...(stance !== undefined ? { stance: stance as typeof lessonStances[number] } : {}),
    ...(strength !== undefined ? { strength: strength as typeof lessonStrengths[number] } : {}),
    ...(mechanism !== undefined ? { mechanism } : {}),
    ...(preventionLayer !== undefined
      ? { preventionLayer: preventionLayer as typeof preventionLayers[number] }
      : {}),
    ...(failedInvariant !== undefined ? { failedInvariant } : {}),
    ...(higherLevelRejections !== undefined ? { higherLevelRejections } : {}),
  };
}

function parseCorrection(value: unknown) {
  const correction = record(value);
  const expectedKeys = ["failedInvariant", "selectedLayer", "mechanism", "higherLevelRejections"];
  if (Object.keys(correction).some((key) => !expectedKeys.includes(key)) || Object.keys(correction).length !== expectedKeys.length)
    throw new InputError("correction is invalid.");
  const selectedLayer = correction.selectedLayer;
  if (!preventionLayers.includes(selectedLayer as typeof preventionLayers[number]))
    throw new InputError("correction.selectedLayer is invalid.");
  const higherLevelRejections = record(correction.higherLevelRejections);
  const expectedLayers = preventionLayers.slice(0, preventionLayers.indexOf(selectedLayer as typeof preventionLayers[number]));
  if (
    Object.keys(higherLevelRejections).length !== expectedLayers.length ||
    Object.keys(higherLevelRejections).some((key) => !expectedLayers.includes(key as typeof preventionLayers[number]))
  ) throw new InputError("correction.higherLevelRejections must explain every stronger prevention layer.");
  return {
    failedInvariant: text(correction.failedInvariant, "correction.failedInvariant", 1000),
    selectedLayer: selectedLayer as typeof preventionLayers[number],
    mechanism: text(correction.mechanism, "correction.mechanism", 512),
    higherLevelRejections: Object.fromEntries(
      expectedLayers.map((layer) => [
        layer,
        text(higherLevelRejections[layer], `correction.higherLevelRejections.${layer}`, 1000),
      ]),
    ),
  };
}

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
  const enforcement = parseLessonEnforcement(candidateValue);
  if (scope === "global" && (enforcement.strength === "blocking" || enforcement.preventionLayer !== undefined) && !foundProject)
    throw new InputError("Enforced global candidates require found project fields.");
  const candidate: Candidate = {
    candidateId: uuid(candidateValue.candidateId, "candidateId"),
    scope: scope as Scope,
    ...project,
    ...foundProject,
    lessonKey: text(candidateValue.lessonKey, "lessonKey", 128),
    title: text(candidateValue.title, "title", 256),
    body: text(candidateValue.body, "body", 10_000),
    rationale: text(candidateValue.rationale, "rationale", 4000),
    evidence,
    createdAt: iso(candidateValue.createdAt, "createdAt"),
    ...enforcement,
  };
  return {
    idempotencyKey: text(body.idempotencyKey, "idempotencyKey", 128),
    candidate,
  };
}

function parseDecisionRecord(value: unknown) {
  const body = record(value);
  const source = record(body.record);
  if (source.schemaVersion !== 1) throw new InputError("Unsupported decision record schemaVersion.");
  const scope = source.scope;
  if (scope !== "project" && scope !== "global") throw new InputError("Invalid scope.");
  const project = scope === "project"
    ? {
        projectKey: text(source.projectKey, "projectKey", 128),
        projectDisplayName: text(source.projectDisplayName, "projectDisplayName", 256),
      }
    : undefined;
  if (scope === "global" && (source.projectKey !== undefined || source.projectDisplayName !== undefined))
    throw new InputError("Global decision records forbid project fields.");
  if ((source.foundProjectKey === undefined) !== (source.foundProjectDisplayName === undefined))
    throw new InputError("Found project fields must be provided together.");
  const foundProject = source.foundProjectKey !== undefined
    ? {
        foundProjectKey: text(source.foundProjectKey, "foundProjectKey", 128),
        foundProjectDisplayName: text(source.foundProjectDisplayName, "foundProjectDisplayName", 256),
      }
    : project
      ? {
          foundProjectKey: project.projectKey,
          foundProjectDisplayName: project.projectDisplayName,
        }
      : undefined;
  if (!foundProject) throw new InputError("Global decision records require found project fields.");
  if (
    project &&
    (project.projectKey !== foundProject.foundProjectKey ||
      project.projectDisplayName !== foundProject.foundProjectDisplayName)
  ) throw new InputError("Project and found project fields must match.");
  if (!Array.isArray(source.options) || source.options.length < 2 || source.options.length > 10)
    throw new InputError("options is invalid.");
  const options = source.options.map((value) => {
    const option = record(value);
    return {
      label: text(option.label, "option.label", 512),
      ...(option.rejectedBecause !== undefined
        ? { rejectedBecause: text(option.rejectedBecause, "option.rejectedBecause", 1000) }
        : {}),
    };
  });
  if (!Array.isArray(source.consequences) || source.consequences.length > 10)
    throw new InputError("consequences is invalid.");
  const consequences = source.consequences.map((value) => text(value, "consequence", 1000));
  if (!Array.isArray(source.evidence) || source.evidence.length > 5)
    throw new InputError("evidence is invalid.");
  const evidence = source.evidence.map((value) => {
    const item = record(value);
    if (!Array.isArray(item.commitHashes) || item.commitHashes.length > 20)
      throw new InputError("Commit hashes are invalid.");
    return {
      excerpt: text(item.excerpt, "evidence.excerpt", 1000),
      commitHashes: item.commitHashes.map((hash) => text(hash, "commitHash", 64)),
    };
  });
  if (source.confidence !== "low" && source.confidence !== "medium" && source.confidence !== "high")
    throw new InputError("confidence is invalid.");
  const base = {
    schemaVersion: 1 as const,
    decisionRecordId: uuid(source.decisionRecordId, "decisionRecordId"),
    taskId: text(source.taskId, "taskId", 256),
    scope: scope as Scope,
    ...project,
    ...(source.foundProjectKey !== undefined ? foundProject : {}),
    summary: text(source.summary, "summary", 512),
    context: text(source.context, "context", 4000),
    options,
    choice: text(source.choice, "choice", 2000),
    rationale: text(source.rationale, "rationale", 4000),
    consequences,
    confidence: source.confidence as "low" | "medium" | "high",
    evidence,
    ...(source.device !== undefined ? { device: text(source.device, "device", 128) } : {}),
    ...(source.harness !== undefined ? { harness: text(source.harness, "harness", 128) } : {}),
    ...(source.skill !== undefined ? { skill: text(source.skill, "skill", 128) } : {}),
    createdAt: iso(source.createdAt, "createdAt"),
  };
  const parsed: DecisionRecord = {
    ...base,
    ...(source.correction !== undefined ? { correction: parseCorrection(source.correction) } : {}),
  };
  rejectSensitiveContent(parsed);
  const idempotencyKey = text(body.idempotencyKey, "idempotencyKey", 128);
  rejectSensitiveContent({ idempotencyKey });
  return {
    idempotencyKey,
    record: parsed,
  };
}

function parseDecisionFeedback(value: unknown): DecisionFeedbackInput {
  const body = record(value);
  if (Object.keys(body).some((key) => !["action", "comment", "expectedFeedbackId"].includes(key)))
    throw new InputError("Feedback body contains unknown fields.");
  if (body.action !== "up" && body.action !== "down" && body.action !== "dismiss")
    throw new InputError("Invalid feedback action.");
  const feedback: DecisionFeedbackInput = {
    action: body.action,
    ...(body.comment !== undefined ? { comment: text(body.comment, "comment", 4000) } : {}),
    ...(body.expectedFeedbackId !== undefined
      ? { expectedFeedbackId: uuid(body.expectedFeedbackId, "expectedFeedbackId") }
      : {}),
  };
  rejectSensitiveContent(feedback);
  return feedback;
}

function parseDecisionRecordFilters(url: URL, now: Date, archiveAfterDays: number): DecisionRecordFilters {
  const scope = singleQuery(url, "scope") ?? "project";
  if (scope !== "project" && scope !== "global") throw new InputError("Invalid scope.");
  const reviewState = singleQuery(url, "reviewState") ?? "unreviewed";
  if (reviewState !== "unreviewed" && reviewState !== "reviewed" && reviewState !== "all")
    throw new InputError("Invalid reviewState.");
  const includeArchivedValue = singleQuery(url, "includeArchived");
  if (includeArchivedValue !== undefined && includeArchivedValue !== "true" && includeArchivedValue !== "false")
    throw new InputError("includeArchived must be true or false.");
  return {
    scope,
    cursor: parseCursorQuery(singleQuery(url, "cursor")),
    limit: parseLimit(singleQuery(url, "limit")),
    reviewState,
    ...optionalQuery(url, "projectKey"),
    ...optionalQuery(url, "taskId"),
    ...optionalQuery(url, "device"),
    ...optionalQuery(url, "harness"),
    ...optionalQuery(url, "skill"),
    ...(singleQuery(url, "from") ? { from: iso(singleQuery(url, "from"), "from") } : {}),
    ...(singleQuery(url, "to") ? { to: iso(singleQuery(url, "to"), "to") } : {}),
    includeArchived: includeArchivedValue === "true",
    archiveAfterDays,
    now,
  };
}

function optionalQuery(url: URL, name: "projectKey" | "taskId" | "device" | "harness" | "skill") {
  const value = singleQuery(url, name);
  return value === undefined ? {} : { [name]: text(value, name, 256) };
}

async function parseDecisionPromotion(value: unknown, repository: ReviewRepository, now: Date, archiveAfterDays: number) {
  const body = record(value);
  if (!Array.isArray(body.decisionRecordIds) || body.decisionRecordIds.length < 1 || body.decisionRecordIds.length > 20)
    throw new InputError("decisionRecordIds is invalid.");
  const decisionRecordIds = [...new Set(body.decisionRecordIds.map((id) => uuid(id, "decisionRecordId")))];
  if (decisionRecordIds.length !== body.decisionRecordIds.length)
    throw new InputError("decisionRecordIds contains duplicates.");
  const draft = record(body.candidate);
  const scope = draft.scope;
  if (scope !== "project" && scope !== "global") throw new InputError("Invalid scope.");
  const project = scope === "project"
    ? {
        projectKey: text(draft.projectKey, "projectKey", 128),
        projectDisplayName: text(draft.projectDisplayName, "projectDisplayName", 256),
      }
    : undefined;
  const items = await Promise.all(decisionRecordIds.map((id) => repository.decisionRecord(id, now, archiveAfterDays)));
  if (items.some((item) => !item.currentFeedback))
    throw new InputError("Every promoted decision record must be reviewed.");
  if (project && items.some((item) => item.record.projectKey !== project.projectKey))
    throw new InputError("Project candidate scope must match every source record.");
  const sourceProject = {
    foundProjectKey: items[0]?.record.foundProjectKey ?? items[0]?.record.projectKey,
    foundProjectDisplayName: items[0]?.record.foundProjectDisplayName ?? items[0]?.record.projectDisplayName,
  };
  if (
    !sourceProject.foundProjectKey ||
    !sourceProject.foundProjectDisplayName ||
    items.some((item) =>
      (item.record.foundProjectKey ?? item.record.projectKey) !== sourceProject.foundProjectKey ||
      (item.record.foundProjectDisplayName ?? item.record.projectDisplayName) !== sourceProject.foundProjectDisplayName)
  ) throw new InputError("Promoted decision records must share one source project.");
  if (
    project &&
    (project.projectKey !== sourceProject.foundProjectKey ||
      project.projectDisplayName !== sourceProject.foundProjectDisplayName)
  ) throw new InputError("Project candidate identity must match source project provenance.");
  const correctionItems = items.filter((item) => item.record.correction !== undefined);
  if (correctionItems.length > 0 && correctionItems.length !== items.length)
    throw new InputError("A promotion cannot mix correction and normal decision records.");
  const correction = correctionItems[0]?.record.correction;
  if (
    correction && correctionItems.some((item) =>
      !item.record.correction ||
      item.record.correction.selectedLayer !== correction.selectedLayer ||
      item.record.correction.mechanism !== correction.mechanism ||
      item.record.correction.failedInvariant !== correction.failedInvariant ||
      preventionLayers.some((layer) =>
        item.record.correction?.higherLevelRejections[layer] !== correction.higherLevelRejections[layer]))
  ) throw new InputError("Promoted corrections must share one correction analysis.");
  const evidence = items.map((item) => ({
    excerpt: [
      ...(item.record.correction
        ? [
            `Failed invariant: ${item.record.correction.failedInvariant}`,
            `Prevention: ${item.record.correction.selectedLayer} through ${item.record.correction.mechanism}`,
          ]
        : []),
      item.record.summary,
      `Choice: ${item.record.choice}`,
    ]
      .join("\n").slice(0, 2000),
    commitHashes: [...new Set(item.record.evidence.flatMap((entry) => entry.commitHashes))].slice(0, 20),
  }));
  const candidate: Candidate = {
    candidateId: uuid(draft.candidateId, "candidateId"),
    scope,
    ...(project
      ? {
          projectKey: sourceProject.foundProjectKey,
          projectDisplayName: sourceProject.foundProjectDisplayName,
        }
      : {}),
    foundProjectKey: sourceProject.foundProjectKey,
    foundProjectDisplayName: sourceProject.foundProjectDisplayName,
    lessonKey: text(draft.lessonKey, "lessonKey", 128),
    title: text(draft.title, "title", 256),
    body: text(draft.body, "body", 10_000),
    rationale: text(draft.rationale, "rationale", 4000),
    evidence,
    createdAt: iso(draft.createdAt, "createdAt"),
    ...(correction
      ? {
          stance: "rule" as const,
          strength: correction.selectedLayer === "architecture" || correction.selectedLayer === "automated_check"
            ? "blocking" as const
            : "advisory" as const,
          mechanism: correction.mechanism,
          preventionLayer: correction.selectedLayer,
          failedInvariant: correction.failedInvariant,
          higherLevelRejections: correction.higherLevelRejections,
        }
      : parseLessonEnforcement(draft)),
  };
  rejectSensitiveContent(candidate);
  const idempotencyKey = text(body.idempotencyKey, "idempotencyKey", 128);
  rejectSensitiveContent({ idempotencyKey });
  return {
    idempotencyKey,
    decisionRecordIds,
    candidate,
  };
}

function rejectSensitiveContent(value: object) {
  const secretPatterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
    /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*(?:"[^"\r\n]{8,}"|'[^'\r\n]{8,}'|[^\s,"'}]{8,})/i,
    /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}={0,2}\b/i,
    /\b(?:ghp|github_pat|sk-(?:proj-)?)[A-Za-z0-9_-]{12,}\b/,
  ];
  const strings = stringValues(value);
  if (strings.some((text) => secretPatterns.some((pattern) => pattern.test(text)) || containsPrivateUrl(text)))
    throw new InputError("Decision content contains a secret-like value or private URL.");
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringValues);
  return [];
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
  return string.toLowerCase();
}

function parseLimit(value: unknown) {
  if (value === undefined) return 50;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 100)
    throw new InputError("limit must be between 1 and 100.");
  return number;
}
