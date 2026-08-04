import { createFileRoute } from "@tanstack/react-router";
import { towerHeartbeat } from "../../../route-handlers.js";

export const Route = createFileRoute("/api/heartbeat/tower")({
  server: { handlers: { POST: towerHeartbeat } }
});
