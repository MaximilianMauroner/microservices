import { createFileRoute } from "@tanstack/react-router";
import { live } from "../route-handlers.js";

export const Route = createFileRoute("/live")({
  server: { handlers: { GET: live, HEAD: live } }
});
