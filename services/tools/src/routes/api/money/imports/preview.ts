import { createFileRoute } from "@tanstack/react-router";
import { previewMoneyImport } from "../../../../../money/money-route-handlers.js";

export const Route = createFileRoute("/api/money/imports/preview")({
  server: { handlers: { POST: previewMoneyImport } }
});
