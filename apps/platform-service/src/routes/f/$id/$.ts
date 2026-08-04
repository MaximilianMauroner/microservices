import { createFileRoute } from "@tanstack/react-router";
import { artifact, redirectLegacyPrefix } from "../../../route-handlers.js";

const redirect = redirectLegacyPrefix("/f", "/files");

export const Route = createFileRoute("/f/$id/$")({
  server: { handlers: { GET: redirect, HEAD: redirect, POST: artifact, PUT: artifact, DELETE: artifact } }
});
