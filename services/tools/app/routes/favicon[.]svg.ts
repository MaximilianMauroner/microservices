import { createFileRoute } from "@tanstack/react-router";
import { favicon } from "../../platform/route-handlers.js";

export const Route = createFileRoute("/favicon.svg")({
  server: { handlers: { GET: favicon, HEAD: favicon } }
});
