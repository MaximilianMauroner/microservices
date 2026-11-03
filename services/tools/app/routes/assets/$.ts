import { createFileRoute } from "@tanstack/react-router";
import { tools } from "../../../platform/route-handlers.js";

export const Route = createFileRoute("/assets/$")({
  server: { handlers: { GET: tools, HEAD: tools } }
});
