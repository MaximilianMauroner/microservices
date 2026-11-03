import { oauthProviderAuthServerMetadata, oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import { createFileRoute } from "@tanstack/react-router";
import { MCP_PATH, protectedResourceMetadata } from "../../../platform/access/mcp.js";
import { getPlatformRuntime } from "../../runtime.js";

const PUBLIC_METADATA = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" };

async function metadata({ request }: { request: Request }) {
  const runtime = await getPlatformRuntime();
  const path = new URL(request.url).pathname;
  if (path === "/.well-known/oauth-protected-resource" || path === `/.well-known/oauth-protected-resource${MCP_PATH}`) {
    return Response.json(protectedResourceMetadata(runtime.publicOrigin), { headers: PUBLIC_METADATA });
  }
  if (path === "/.well-known/oauth-authorization-server" || path === "/.well-known/oauth-authorization-server/api/auth") {
    return oauthProviderAuthServerMetadata(runtime.auth, { headers: PUBLIC_METADATA })(request);
  }
  if (path === "/.well-known/openid-configuration" || path === "/.well-known/openid-configuration/api/auth") {
    return oauthProviderOpenIdConfigMetadata(runtime.auth, { headers: PUBLIC_METADATA })(request);
  }
  return new Response(null, { status: 404 });
}

export const Route = createFileRoute("/.well-known/$")({
  server: { handlers: { GET: metadata } }
});
