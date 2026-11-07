import { createFileRoute } from "@tanstack/react-router";
import { handleBodyshopActions } from "../../../../../products/bodyshop/app.js";
import { getPlatformRuntime } from "../../../../runtime.js";

async function actions({ request }: { request: Request }) {
  const runtime = await getPlatformRuntime();
  return handleBodyshopActions(request, (one) => runtime.resolveAppToken(one, "pantrino"), runtime.bodyshop);
}

export const Route = createFileRoute("/api/bodyshop/app/actions")({
  server: { handlers: { POST: actions } }
});
