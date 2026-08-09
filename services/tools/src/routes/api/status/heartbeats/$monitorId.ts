import { createFileRoute } from "@tanstack/react-router";
import { statusHeartbeat } from "../../../../route-handlers.js";

export const Route = createFileRoute("/api/status/heartbeats/$monitorId")({
  server: { handlers: { POST: statusHeartbeat } }
});
