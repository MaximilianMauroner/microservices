import { createFileRoute } from "@tanstack/react-router";
import { updateMoneyAccount } from "../../../../products/money/money-route-handlers.js";

export const Route = createFileRoute("/api/money/accounts")({
  server: { handlers: { POST: updateMoneyAccount } }
});
