import { createFileRoute } from "@tanstack/react-router";
import { artifact } from "../../../platform/route-handlers.js";

export const Route = createFileRoute("/drop/$")({
  server: { handlers: { GET: artifact, HEAD: artifact } }
});
