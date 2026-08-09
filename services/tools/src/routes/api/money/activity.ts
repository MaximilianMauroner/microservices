import { createFileRoute } from "@tanstack/react-router";
import { getMoneyActivity } from "../../../../money/money-route-handlers.js";

export const Route = createFileRoute("/api/money/activity")({
  server: { handlers: { GET: getMoneyActivity } }
});
