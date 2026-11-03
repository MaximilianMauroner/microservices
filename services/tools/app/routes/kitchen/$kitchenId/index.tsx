import { createFileRoute } from "@tanstack/react-router";
import { getKitchenWeek } from "../../../../products/kitchen/server-functions.js";
import { KitchenWeekPage } from "../../../../products/kitchen/ui/week.js";
import { KITCHEN_PAGE_ROUTE } from "../../../../products/kitchen/ui/kit.js";

export const Route = createFileRoute("/kitchen/$kitchenId/")({
  ...KITCHEN_PAGE_ROUTE,
  validateSearch: (search: Record<string, unknown>): { week?: string } => (typeof search.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.week) ? { week: search.week } : {}),
  loaderDeps: ({ search }) => ({ week: search.week }),
  loader: ({ params, deps }) => getKitchenWeek({ data: { kitchenId: params.kitchenId, week: deps.week } }),
  component: () => <KitchenWeekPage {...Route.useLoaderData()} />
});
