import { createFileRoute } from "@tanstack/react-router";
import { updateMoneyTransfer } from "../../../../products/money/money-route-handlers.js";

export const Route = createFileRoute("/api/money/transfers")({
  server: { handlers: { POST: updateMoneyTransfer } }
});
