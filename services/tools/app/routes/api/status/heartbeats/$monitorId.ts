import { createFileRoute } from "@tanstack/react-router";
import { statusHeartbeat } from "../../../../../platform/route-handlers.js";

export const Route = createFileRoute("/api/status/heartbeats/$monitorId")({
  server: { handlers: { POST: statusHeartbeat } }
});
