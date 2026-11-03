import { createFileRoute } from "@tanstack/react-router";
import { favicon } from "../../platform/route-handlers.js";

export const Route = createFileRoute("/favicon.ico")({
  server: { handlers: { GET: favicon, HEAD: favicon } }
});
