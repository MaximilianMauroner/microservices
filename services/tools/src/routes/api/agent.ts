import { createFileRoute } from "@tanstack/react-router";
import { fieldGuide } from "../../route-handlers.js";

export const Route = createFileRoute("/api/agent")({
  server: {
    handlers: { GET: fieldGuide, POST: fieldGuide, PUT: fieldGuide, PATCH: fieldGuide, DELETE: fieldGuide }
  }
});
