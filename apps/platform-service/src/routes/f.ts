import { createFileRoute } from "@tanstack/react-router";
import { artifact, redirectTo } from "../route-handlers.js";

const redirect = redirectTo("/files");

export const Route = createFileRoute("/f")({
  server: { handlers: { GET: redirect, HEAD: redirect, POST: artifact } }
});
