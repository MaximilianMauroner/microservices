import { createFileRoute } from "@tanstack/react-router";
import { readOnly, tools } from "../../../route-handlers.js";

export const Route = createFileRoute("/api/ops/$")({
  server: {
    handlers: { GET: tools, HEAD: tools, POST: readOnly, PUT: readOnly, PATCH: readOnly, DELETE: readOnly }
  }
});
