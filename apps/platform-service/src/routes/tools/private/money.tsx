import { createFileRoute } from "@tanstack/react-router";
import { MoneyTrackerPage, MoneyTrackerPendingPage, type MoneyTrackerView } from "../../../components/money-tracker-page.js";
import { getMoneyTrackerPageData } from "../../../protected-data.js";

export const Route = createFileRoute("/tools/private/money")({
  validateSearch: (search: Record<string, unknown>): { view?: Exclude<MoneyTrackerView, "overview"> } => ({ view: search.view === "accounts" || search.view === "history" || search.view === "predictions" ? search.view : undefined }),
  loader: () => getMoneyTrackerPageData(),
  pendingComponent: MoneyTrackerPendingRoute,
  pendingMs: 0,
  pendingMinMs: 250,
  head: () => ({ meta: [{ title: "Money tracker — Mauroner Tools" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: MoneyTrackerRoute
});

function MoneyTrackerRoute() {
  return <MoneyTrackerPage {...Route.useLoaderData()} view={Route.useSearch().view ?? "overview"} />;
}

function MoneyTrackerPendingRoute() {
  return <MoneyTrackerPendingPage view={Route.useSearch().view ?? "overview"} />;
}
