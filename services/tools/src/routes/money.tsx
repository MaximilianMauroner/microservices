import { createFileRoute } from "@tanstack/react-router";
import { MoneyTrackerPage, MoneyTrackerPendingPage, type MoneyTrackerView } from "../../money/money-tracker-page.js";
import { getMoneyTrackerPageData } from "../protected-data.js";
import { faviconLink, favicons } from "../favicons.js";
import { requireRouteSession } from "../auth-session.js";
import { MONEY_CATEGORIES, type MoneyCategory } from "../../money/money-enums.js";

type MoneySearch = { view?: Exclude<MoneyTrackerView, "overview">; category?: MoneyCategory };

export const Route = createFileRoute("/money")({
  beforeLoad: ({ location }) => requireRouteSession(location.href),
  validateSearch: (search: Record<string, unknown>): MoneySearch => ({
    view: search.view === "cash-flow" || search.view === "transactions" || search.view === "investments" || search.view === "accounts" || search.view === "categories" || search.view === "insights" || search.view === "data" ? search.view : undefined,
    category: typeof search.category === "string" && MONEY_CATEGORIES.includes(search.category as MoneyCategory) ? search.category as MoneyCategory : undefined
  }),
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
  const search = Route.useSearch();
  return <MoneyTrackerPage {...Route.useLoaderData()} view={search.view ?? "overview"} category={search.category} />;
}

function MoneyTrackerPendingRoute() {
  return <MoneyTrackerPendingPage view={Route.useSearch().view ?? "overview"} />;
}
