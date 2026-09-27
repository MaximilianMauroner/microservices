import { createFileRoute } from "@tanstack/react-router";
import { artifact } from "../../route-handlers.js";

/** Browser-session HTML publishing; the native /api/uploads bearer API remains separate. */
export const Route = createFileRoute("/api/browser-html-uploads")({
  server: { handlers: { POST: artifact } }
});
