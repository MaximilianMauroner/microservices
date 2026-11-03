import { createFileRoute } from "@tanstack/react-router";
import { addMoneyBalance } from "../../../../products/money/money-route-handlers.js";

export const Route = createFileRoute("/api/money/balances")({
  server: { handlers: { POST: addMoneyBalance } }
});
