import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { env, httpAction } from "./_generated/server";

const ADMIN_DOCUMENT_LIMIT = 200;
const MAX_BEARER_TOKEN_LENGTH = 512;
const encoder = new TextEncoder();

const http = httpRouter();

http.route({
  path: "/admin/documents",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const configuredToken = env.MARKDOWN_SHARE_ADMIN_TOKEN;

    const suppliedToken = bearerToken(request);
    if (
      suppliedToken === null ||
      !(await secretsEqual(suppliedToken, configuredToken))
    ) {
      return json({ error: "unauthorized" }, 401, {
        "WWW-Authenticate": "Bearer",
      });
    }

    const generatedAt = Date.now();
    const result = await ctx.runQuery(internal.admin.listActiveDocuments, {
      now: generatedAt,
      limit: ADMIN_DOCUMENT_LIMIT,
    });
    return json({ generatedAt, ...result });
  }),
});

export default http;

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  if (token.length < 32 || token.length > MAX_BEARER_TOKEN_LENGTH) return null;
  return token;
}

async function secretsEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let mismatch = 0;
  for (const [index, leftByte] of leftBytes.entries()) {
    mismatch |= leftByte ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

function json(
  body: unknown,
  status = 200,
  additionalHeaders: HeadersInit = {},
): Response {
  const headers = new Headers(additionalHeaders);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers });
}
