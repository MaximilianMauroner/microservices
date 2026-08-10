import { createFileRoute } from "@tanstack/react-router";
import { MoneyTrackerPage, MoneyTrackerPendingPage, type MoneyTrackerView } from "../../money/money-tracker-page.js";
import { getMoneyTrackerPageData } from "../protected-data.js";
import { faviconLink, favicons } from "../favicons.js";
import { requireRouteSession } from "../auth-session.js";

export const Route = createFileRoute("/money")({
  beforeLoad: ({ location }) => requireRouteSession(location.href),
  validateSearch: (search: Record<string, unknown>): { view?: Exclude<MoneyTrackerView, "overview"> } => ({ view: search.view === "cash-flow" || search.view === "transactions" || search.view === "investments" || search.view === "accounts" || search.view === "insights" || search.view === "data" ? search.view : undefined }),
  loader: () => getMoneyTrackerPageData(),
  pendingComponent: MoneyTrackerPendingRoute,
  pendingMs: 0,
  pendingMinMs: 250,
  head: () => ({
    meta: [{ title: "Money dashboard | Mauroner Tools" }, { name: "robots", content: "noindex, nofollow" }],
    links: [faviconLink(favicons.money)]
  }),
  component: MoneyTrackerRoute
});

function MoneyTrackerRoute() {
  return <MoneyTrackerPage {...Route.useLoaderData()} view={Route.useSearch().view ?? "overview"} />;
}

function MoneyTrackerPendingRoute() {
  return <MoneyTrackerPendingPage view={Route.useSearch().view ?? "overview"} />;
}
