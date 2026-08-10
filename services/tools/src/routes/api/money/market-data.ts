import { createFileRoute } from "@tanstack/react-router";
import { getMoneyMarketData, syncMoneyMarketData } from "../../../../money/money-route-handlers.js";

export const Route = createFileRoute("/api/money/market-data")({
  server: { handlers: { GET: getMoneyMarketData, POST: syncMoneyMarketData } }
});
