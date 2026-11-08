import { createFileRoute } from "@tanstack/react-router";
import { handleKitchenSync } from "../../../../products/kitchen/sync.js";
import { getPlatformRuntime } from "../../../runtime.js";

async function sync({ request }: { request: Request }) {
  const runtime = await getPlatformRuntime();
  return handleKitchenSync(request, (one) => runtime.resolveAppToken(one, "pantrino"), runtime.kitchen);
}

export const Route = createFileRoute("/api/kitchen/sync")({
  server: { handlers: { GET: sync } }
});
