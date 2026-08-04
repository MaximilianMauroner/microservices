import { createFileRoute } from "@tanstack/react-router";
import { artifact, redirectTo } from "../../route-handlers.js";

const redirect = redirectTo("/publish");

export const Route = createFileRoute("/uploads/$")({
  server: { handlers: { GET: redirect, HEAD: redirect, POST: artifact, PUT: artifact, DELETE: artifact } }
});
