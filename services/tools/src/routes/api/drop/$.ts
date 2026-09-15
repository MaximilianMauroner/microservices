import { createFileRoute } from "@tanstack/react-router";
import { artifact } from "../../../route-handlers.js";

export const Route = createFileRoute("/api/drop/$")({
  server: { handlers: { POST: artifact } }
});
