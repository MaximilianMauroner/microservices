import { createFileRoute } from "@tanstack/react-router";
import { MoneyTrackerPage } from "../../money/money-tracker-page.js";
import { MoneyTrackerPendingPage } from "../../money/money-tracker-pending-page.js";
import type { MoneyTrackerView } from "../../money/money-tracker-navigation.js";
import { getMoneyTrackerPageData } from "../protected-data.js";
import { faviconLink, favicons } from "../favicons.js";
import { requireRouteSession } from "../auth-session.js";
import { MONEY_CATEGORIES, type MoneyCategory } from "../../money/money-enums.js";

type MoneySearch = { view?: Exclude<MoneyTrackerView, "overview">; category?: MoneyCategory; review?: boolean; fromMonth?: string; toMonth?: string; since?: string };

export const Route = createFileRoute("/money")({
  beforeLoad: ({ location }) => requireRouteSession(location.href),
  validateSearch: (search: Record<string, unknown>): MoneySearch => ({
    view: search.view === "cash-flow" || search.view === "transactions" || search.view === "investments" || search.view === "accounts" || search.view === "categories" || search.view === "insights" || search.view === "predictions" || search.view === "data" ? search.view : undefined,
    category: typeof search.category === "string" && MONEY_CATEGORIES.includes(search.category as MoneyCategory) ? search.category as MoneyCategory : undefined,
    review: search.review === true || search.review === "true" ? true : undefined,
    fromMonth: typeof search.fromMonth === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(search.fromMonth) ? search.fromMonth : undefined,
    toMonth: typeof search.toMonth === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(search.toMonth) ? search.toMonth : undefined,
    since: typeof search.since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.since) ? search.since : undefined
  }),
  loaderDeps: ({ search }) => ({ view: (search.view ?? "overview") as MoneyTrackerView, since: search.since }),
  loader: ({ deps }) => getMoneyTrackerPageData({ data: deps }),
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
  return <MoneyTrackerPage {...Route.useLoaderData()} view={search.view ?? "overview"} category={search.category} review={search.review} fromMonth={search.fromMonth} toMonth={search.toMonth} />;
}

function MoneyTrackerPendingRoute() {
  return <MoneyTrackerPendingPage view={Route.useSearch().view ?? "overview"} />;
}
