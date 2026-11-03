import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { PlatformPrincipal } from "#security";
import { GRANTABLE_PRODUCTS, grantedProducts } from "./product-access.js";

export const MCP_PATH = "/api/mcp";
export const MCP_RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;

type AccessTokenResolver = (request: Request) => Promise<PlatformPrincipal | undefined>;

/** Serves one stateless MCP request as the person who owns the bearer token. */
export async function handleMcpRequest(request: Request, publicOrigin: string, resolveAccessToken: AccessTokenResolver): Promise<Response> {
  const principal = await resolveAccessToken(request);
  if (!principal) {
    return Response.json({ error: "invalid_token" }, {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": `Bearer resource_metadata="${publicOrigin}${MCP_RESOURCE_METADATA_PATH}"`
      }
    });
  }
  const server = mcpServerFor(principal);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

export function protectedResourceMetadata(publicOrigin: string) {
  return {
    resource: `${publicOrigin}${MCP_PATH}`,
    authorization_servers: [`${publicOrigin}/api/auth`],
    bearer_methods_supported: ["header"],
    resource_name: "Mauroner Tools"
  };
}

function mcpServerFor(principal: PlatformPrincipal) {
  const server = new McpServer({ name: "mauroner-tools", version: "1.0.0" });
  server.registerTool("whoami", {
    title: "Who am I",
    description: "Returns the signed-in Tools account and the tools it can open.",
    annotations: { readOnlyHint: true }
  }, () => ({
    content: [{
      type: "text",
      text: JSON.stringify({
        email: principal.email,
        role: principal.role,
        tools: principal.role === "admin" ? "all" : grantedProducts(principal).map((id) => GRANTABLE_PRODUCTS[id].label)
      })
    }]
  }));
  return server;
}
