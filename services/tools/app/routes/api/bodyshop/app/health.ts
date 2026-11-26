import { createFileRoute } from "@tanstack/react-router";
import { handleBodyshopHealth } from "../../../../../products/bodyshop/health.js";
import { getPlatformRuntime } from "../../../../runtime.js";

async function health({ request }: { request: Request }) {
  const runtime = await getPlatformRuntime();
  return handleBodyshopHealth(request, (one) => runtime.resolveAppToken(one, "pantrino"), runtime.bodyshop);
}

export const Route = createFileRoute("/api/bodyshop/app/health")({
  server: { handlers: { GET: health, POST: health } }
});
