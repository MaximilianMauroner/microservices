import { createFileRoute } from "@tanstack/react-router";
import { deleteMoneyImport } from "../../../../../products/money/money-route-handlers.js";

export const Route = createFileRoute("/api/money/imports/$importId")({
  server: { handlers: { DELETE: deleteMoneyImport } }
});
