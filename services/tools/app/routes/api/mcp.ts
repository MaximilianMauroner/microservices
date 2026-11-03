import { createFileRoute } from "@tanstack/react-router";
import { handleMcpRequest } from "../../../platform/access/mcp.js";
import { principalSeesProduct } from "../../../platform/access/product-access.js";
import { registerKitchenTools } from "../../../products/kitchen/mcp-tools.js";
import { getPlatformRuntime } from "../../runtime.js";

async function mcp({ request }: { request: Request }) {
  const runtime = await getPlatformRuntime();
  return handleMcpRequest(request, runtime.publicOrigin, runtime.resolveAccessToken, (server, principal) => {
    if (principalSeesProduct(principal, "kitchen")) registerKitchenTools(server, runtime.kitchen, principal);
  });
}

export const Route = createFileRoute("/api/mcp")({
  server: { handlers: { GET: mcp, POST: mcp, DELETE: mcp } }
});
