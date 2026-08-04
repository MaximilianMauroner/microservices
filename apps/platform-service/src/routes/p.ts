import { createFileRoute } from "@tanstack/react-router";
import { artifact, redirectTo } from "../route-handlers.js";

const redirect = redirectTo("/artifacts");

export const Route = createFileRoute("/p")({
  server: { handlers: { GET: redirect, HEAD: redirect, POST: artifact } }
});
