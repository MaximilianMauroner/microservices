import { createFileRoute } from "@tanstack/react-router";
import { fieldGuide } from "../../../route-handlers.js";

export const Route = createFileRoute("/api/review/$")({
  server: {
    handlers: { GET: fieldGuide, HEAD: fieldGuide, POST: fieldGuide, PUT: fieldGuide, PATCH: fieldGuide, DELETE: fieldGuide }
  }
});
