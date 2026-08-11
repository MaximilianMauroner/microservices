import { createFileRoute } from "@tanstack/react-router";
import { deleteMoneyCategoryRule, updateMoneyCategory } from "../../../../money/money-route-handlers.js";

export const Route = createFileRoute("/api/money/categories")({
  server: { handlers: { POST: updateMoneyCategory, DELETE: deleteMoneyCategoryRule } }
});
