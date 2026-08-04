import { createFileRoute } from "@tanstack/react-router";
import { fieldGuide } from "../route-handlers.js";

export const Route = createFileRoute("/review.css")({
  server: { handlers: { GET: fieldGuide, HEAD: fieldGuide } }
});
