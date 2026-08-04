import { createFileRoute } from "@tanstack/react-router";
import { artifact, redirectLegacyPrefix } from "../../route-handlers.js";

const redirect = redirectLegacyPrefix("/p", "/artifacts");

export const Route = createFileRoute("/p/$")({
  server: { handlers: { GET: redirect, HEAD: redirect, POST: artifact, PUT: artifact, DELETE: artifact } }
});
