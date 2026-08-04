import { createFileRoute } from "@tanstack/react-router";
import { redirectLegacyPrefix, tools } from "../route-handlers.js";

const redirect = redirectLegacyPrefix("/ops", "/manage");

export const Route = createFileRoute("/ops")({
  server: { handlers: { GET: redirect, HEAD: redirect, POST: tools } }
});
