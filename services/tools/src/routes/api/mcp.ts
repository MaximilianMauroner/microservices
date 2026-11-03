import { createFileRoute } from "@tanstack/react-router";
import { handleMcpRequest } from "../../mcp.js";
import { getPlatformRuntime } from "../../runtime.js";

async function mcp({ request }: { request: Request }) {
  const runtime = await getPlatformRuntime();
  return handleMcpRequest(request, runtime.publicOrigin, runtime.resolveAccessToken);
}

export const Route = createFileRoute("/api/mcp")({
  server: { handlers: { GET: mcp, POST: mcp, DELETE: mcp } }
});
