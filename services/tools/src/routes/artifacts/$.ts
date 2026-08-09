import { createFileRoute } from "@tanstack/react-router";
import { artifact } from "../../route-handlers.js";

export const Route = createFileRoute("/artifacts/$")({
  server: { handlers: { GET: artifact, HEAD: artifact } }
});
