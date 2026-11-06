import { createFileRoute } from "@tanstack/react-router";
import { handleKitchenCatalog } from "../../../../products/kitchen/sync.js";
import { getPlatformRuntime } from "../../../runtime.js";

async function products({ request }: { request: Request }) {
  const runtime = await getPlatformRuntime();
  return handleKitchenCatalog(request, (one) => runtime.resolveAppToken(one, "kitchen"), runtime.kitchenCatalog);
}

export const Route = createFileRoute("/api/kitchen/products")({
  server: { handlers: { GET: products } }
});
