import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import type {
  AmendVerdictInput,
  Candidate,
  ReviewRepository,
  Scope,
  VerdictInput,
} from "./types.js";
import { ConflictError, ValidationError } from "./types.js";
export function createApp(o: {
  repository: ReviewRepository;
  agentAuth: RequestHandler;
  reviewerAuth: RequestHandler;
  publicBaseUrl: string;
  now?: () => Date;
}) {
  const app = express();
  const now = o.now ?? (() => new Date());
  app.disable("x-powered-by");
  app.use((_q, r, n) => {
    r.set({
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'self'; script-src 'self' https://shoo.dev; connect-src 'self' https://shoo.dev; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    n();
  });
  app.use(express.json({ limit: "128kb" }));
  app.get("/health", (_q, r) => r.json({ ok: true }));
  const agent = express.Router();
  agent.use(o.agentAuth);
  agent.post(
    "/candidates",
    asyncRoute(async (req, res) => {
      const parsed = parseCandidate(req.body);
      const result = await o.repository.createCandidate(
        parsed.idempotencyKey,
        parsed.candidate,
      );
      res.status(result === "created" ? 201 : 200).json({ status: result });
    }),
  );
  agent.get(
    "/decisions",
    asyncRoute(async (req, res) => {
      const limit = parseLimit(req.query.limit);
      const page = await o.repository.decisions(
        typeof req.query.cursor === "string" ? req.query.cursor : undefined,
        limit,
      );
      res.json({ ...page, summary: await o.repository.summary(now()) });
    }),
  );
  agent.post(
    "/receipts",
    asyncRoute(async (req, res) => {
      const b = record(req.body);
      const key = text(b.idempotencyKey, "idempotencyKey", 128);
      const id = uuid(b.decisionId, "decisionId");
      const at = iso(b.appliedAt, "appliedAt");
      if (b.result !== "applied" && b.result !== "already_applied")
        throw new InputError("Invalid result.");
      const result = await o.repository.createReceipt(key, id, at, b.result);
      res.status(result === "created" ? 201 : 200).json({ status: result });
    }),
  );
  app.use("/api/agent", agent);
  const review = express.Router();
  review.use(o.reviewerAuth);
  review.get(
    "/queue",
    asyncRoute(async (req, res) => {
      const scope = req.query.scope;
      if (scope !== undefined && scope !== "project" && scope !== "global")
        throw new InputError("Invalid scope.");
      res.json({
        items: await o.repository.queue(scope as Scope | undefined, now()),
        summary: await o.repository.summary(now()),
      });
    }),
  );
  review.get("/history",asyncRoute(async(req,res)=>{const scope=parseScope(req.query.scope);const page=await o.repository.history(typeof req.query.cursor==="string"?req.query.cursor:undefined,parseLimit(req.query.limit),scope);res.json({...page,summary:await o.repository.summary(now())});}));
  review.post(
    "/candidates/:id/rounds/:round/verdict",
    sameOrigin(o.publicBaseUrl),
    asyncRoute(async (req, res) => {
      const input = parseVerdict(req.body);
      res
        .status(201)
        .json({
          decision: await o.repository.decide(
            uuid(req.params.id,"candidateId"),
            parseRound(req.params.round),
            input,
            now(),
            typeof res.locals.shooEmail==="string"?res.locals.shooEmail:"system",
          ),
        });
    }),
  );
  review.post(
    "/candidates/:id/rounds/:round/amendments",
    sameOrigin(o.publicBaseUrl),
    asyncRoute(async (req, res) => {
      const input = parseAmendment(req.body);
      res.status(201).json({
        decision: await o.repository.amendDecision(
          uuid(req.params.id, "candidateId"),
          parseRound(req.params.round),
          input,
          now(),
          typeof res.locals.shooEmail === "string"
            ? res.locals.shooEmail
            : "system",
        ),
      });
    }),
  );
  app.use("/api/review", review);
  app.get("/", (_req,res)=>res.redirect(302,"/review"));
  app.all(/^\/api\//, (_q, r) =>
    r.status(404).json({ error: "not_found", message: "Route not found." }),
  );
  app.use((e: unknown, _q: Request, r: Response, _n: NextFunction) => {
    if (e instanceof ConflictError) {
      r.status(409).json({ error: "conflict", message: e.message });
      return;
    }
    if (
      e instanceof InputError ||
      e instanceof ValidationError ||
      e instanceof SyntaxError
    ) {
      r.status(400).json({ error: "invalid_request", message: e.message });
      return;
    }
    console.error(e);
    r.status(500).json({ error: "internal_error", message: "Request failed." });
  });
  return app;
}
function sameOrigin(publicBaseUrl:string): RequestHandler {
  return (req, res, next) => {
    const supplied = req.get("origin");
    const expected = new URL(publicBaseUrl).origin;
    if (req.method === "POST" && (!supplied || supplied !== expected)) {
      res
        .status(403)
        .json({
          error: "origin_forbidden",
          message: "Request origin is not allowed.",
        });
      return;
    }
    next();
  };
}
class InputError extends Error {}
const record = (v: unknown): Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    throw new InputError("JSON object required.");
  return v as Record<string, unknown>;
};
const text = (v: unknown, n: string, max: number) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw new InputError(`${n} is invalid.`);
  return v;
};
const iso = (v: unknown, n: string) => {
  const s = text(v, n, 64);
  if (!Number.isFinite(new Date(s).getTime()))
    throw new InputError(`${n} is invalid.`);
  return new Date(s).toISOString();
};
function parseCandidate(value: unknown) {
  const b = record(value),
    c = record(b.candidate);
  const scope = c.scope;
  if (scope !== "project" && scope !== "global")
    throw new InputError("Invalid scope.");
  if (scope === "project" && (!c.projectKey || !c.projectDisplayName))
    throw new InputError("Project fields are required.");
  if (scope === "global" && (c.projectKey || c.projectDisplayName))
    throw new InputError("Global candidates forbid project fields.");
  if (
    !Array.isArray(c.evidence) ||
    c.evidence.length < 1 ||
    c.evidence.length > 20
  )
    throw new InputError("Evidence is invalid.");
  const evidence = c.evidence.map((v) => {
    const e = record(v);
    if (!Array.isArray(e.commitHashes) || e.commitHashes.length > 20)
      throw new InputError("Commit hashes are invalid.");
    return {
      excerpt: text(e.excerpt, "excerpt", 2000),
      ...(e.sessionRef
        ? { sessionRef: text(e.sessionRef, "sessionRef", 256) }
        : {}),
      commitHashes: e.commitHashes.map((x) => text(x, "commitHash", 64)),
    };
  });
  const candidate: Candidate = {
    candidateId: uuid(c.candidateId, "candidateId"),
    scope,
    ...(scope === "project"
      ? {
          projectKey: text(c.projectKey, "projectKey", 128),
          projectDisplayName: text(
            c.projectDisplayName,
            "projectDisplayName",
            256,
          ),
        }
      : {}),
    lessonKey: text(c.lessonKey, "lessonKey", 128),
    title: text(c.title, "title", 256),
    body: text(c.body, "body", 10000),
    rationale: text(c.rationale, "rationale", 4000),
    evidence,
    createdAt: iso(c.createdAt, "createdAt"),
  };
  return {
    idempotencyKey: text(b.idempotencyKey, "idempotencyKey", 128),
    candidate,
  };
}
function parseScope(v:unknown):Scope|undefined{if(v===undefined)return undefined;if(v!=="project"&&v!=="global")throw new InputError("Invalid scope.");return v;}
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
function uuid(v:unknown,name:string){const value=text(v,name,36);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new InputError(`${name} must be a UUID.`);return value;}
function parseLimit(v: unknown) {
  if (v === undefined) return 50;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 100)
    throw new InputError("limit must be between 1 and 100.");
  return n;
}
function asyncRoute(
  fn: (q: Request, r: Response) => Promise<void>,
): RequestHandler {
  return (q, r, n) => void fn(q, r).catch(n);
}
