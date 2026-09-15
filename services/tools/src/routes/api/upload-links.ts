import { createFileRoute } from "@tanstack/react-router";
import { artifact } from "../../route-handlers.js";

export const Route = createFileRoute("/api/upload-links")({
  server: { handlers: { GET: artifact, POST: artifact } }
});
