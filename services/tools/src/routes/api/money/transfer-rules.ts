import { createFileRoute } from "@tanstack/react-router";
import { deleteMoneyTransferRule, saveMoneyTransferRule } from "../../../../money/money-route-handlers.js";

export const Route = createFileRoute("/api/money/transfer-rules")({
  server: { handlers: { POST: saveMoneyTransferRule, DELETE: deleteMoneyTransferRule } }
});
