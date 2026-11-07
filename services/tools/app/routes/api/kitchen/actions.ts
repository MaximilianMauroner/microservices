import { createFileRoute } from "@tanstack/react-router";
import { handleKitchenActions } from "../../../../products/kitchen/sync.js";
import { getPlatformRuntime } from "../../../runtime.js";

async function actions({ request }: { request: Request }) {
  const runtime = await getPlatformRuntime();
  return handleKitchenActions(request, (one) => runtime.resolveAppToken(one, "pantrino"), runtime.kitchen);
}

export const Route = createFileRoute("/api/kitchen/actions")({
  server: { handlers: { POST: actions } }
});
