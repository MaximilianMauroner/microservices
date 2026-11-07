import { createFileRoute } from "@tanstack/react-router";
import { handleBodyshopToday } from "../../../../../products/bodyshop/app.js";
import { getPlatformRuntime } from "../../../../runtime.js";

async function today({ request }: { request: Request }) {
  const runtime = await getPlatformRuntime();
  return handleBodyshopToday(request, (one) => runtime.resolveAppToken(one, "pantrino"), runtime.bodyshop);
}

export const Route = createFileRoute("/api/bodyshop/app/today")({
  server: { handlers: { GET: today } }
});
