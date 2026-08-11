import { createFileRoute } from "@tanstack/react-router";
import { reimportAllMoneyImports } from "../../../../../money/money-route-handlers.js";

export const Route = createFileRoute("/api/money/imports/reimport")({
  server: { handlers: { POST: reimportAllMoneyImports } }
});
