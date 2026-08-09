import { createServer } from "node:http";

const token = process.env.MARKDOWN_SHARE_ADMIN_TOKEN?.trim();
const port = process.env.PORT ?? "8787";
const expected = token ?? "";

if (!token || token.length < 32) {
  throw new Error("MARKDOWN_SHARE_ADMIN_TOKEN must be at least 32 characters");
}

const server = createServer(async (incoming, outgoing) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(name, item);
  }
  const request = new Request(`http://${incoming.headers.host ?? `localhost:${port}`}${incoming.url ?? "/"}`, {
    method: incoming.method,
    headers
  });
  const response = await handle(request);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(Number(port));

async function handle(request: Request) {
    const response = route(request);
    if (response) return response;

    const url = new URL(request.url);
    if (url.pathname === "/admin/documents") {
      const authorization = request.headers.get("authorization") ?? "";
      if (
        (request.method !== "GET" && request.method !== "HEAD") ||
        authorization !== `Bearer ${expected}`
      ) {
        return unauthorized();
      }
      const now = Date.now();
      return jsonResponse({
        generatedAt: now,
        documents: [
          {
            token: "local-product-brief-token-0001",
            filename: "product-brief.md",
            createdAt: now - 2 * 24 * 60 * 60 * 1000,
            updatedAt: now - 25 * 60 * 1000,
            expiresAt: now + 22 * 60 * 60 * 1000,
            checkpointCount: 3
          },
          {
            token: "local-release-notes-token-0002",
            filename: "release-notes.md",
            createdAt: now - 5 * 24 * 60 * 60 * 1000,
            updatedAt: now - 4 * 60 * 60 * 1000,
            expiresAt: now + 3 * 24 * 60 * 60 * 1000,
            checkpointCount: 1
          },
          {
            token: "local-scratch-notes-token-0003",
            filename: "scratch-notes.md",
            createdAt: now - 3 * 60 * 60 * 1000,
            updatedAt: now - 2 * 60 * 60 * 1000,
            expiresAt: now + 7 * 24 * 60 * 60 * 1000,
            checkpointCount: 0
          }
        ],
        truncated: false
      });
    }

    if (url.pathname === "/health") {
      return jsonResponse({ ok: true, service: "markdown-share-mock" });
    }

    if (url.pathname === "/") {
      return new Response(
        "<html><body><h1>Markdown Share mock</h1><p>Local endpoint for local stack.</p></body></html>",
        {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8"
          }
        }
      );
    }

    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
}

function route(request: Request): Response | undefined {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Origin": "*" }
    });
  }
  return undefined;
}

function unauthorized() {
  return jsonResponse({ error: "authentication_required" }, 401, {
    "WWW-Authenticate": 'Bearer realm="markdown-share-admin"'
  });
}

function jsonResponse(body: object, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...extra,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
