import { createFileRoute } from "@tanstack/react-router";
import { tools } from "../../../../platform/route-handlers.js";

export const Route = createFileRoute("/api/public/catalog")({
  server: { handlers: { GET: tools, HEAD: tools } }
});
