import { createFileRoute } from "@tanstack/react-router";
import { commitMoneyImport } from "../../../../products/money/money-route-handlers.js";

export const Route = createFileRoute("/api/money/imports")({
  server: { handlers: { POST: commitMoneyImport } }
});
