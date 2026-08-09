import { createFileRoute } from "@tanstack/react-router";
import { artifact } from "../../route-handlers.js";

export const Route = createFileRoute("/api/uploads")({
  server: {
    handlers: { GET: artifact, HEAD: artifact, POST: artifact, PUT: artifact, PATCH: artifact, DELETE: artifact }
  }
});
