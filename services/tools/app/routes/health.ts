import { createFileRoute } from "@tanstack/react-router";
import { health } from "../../platform/route-handlers.js";

export const Route = createFileRoute("/health")({
  server: { handlers: { GET: health, HEAD: health } }
});
