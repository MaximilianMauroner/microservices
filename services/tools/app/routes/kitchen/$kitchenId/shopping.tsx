import { createFileRoute } from "@tanstack/react-router";
import { getKitchenShopping } from "../../../../products/kitchen/server-functions.js";
import { KitchenShoppingPage } from "../../../../products/kitchen/ui/shopping.js";
import { KITCHEN_PAGE_ROUTE } from "../../../../products/kitchen/ui/kit.js";

export const Route = createFileRoute("/kitchen/$kitchenId/shopping")({
  ...KITCHEN_PAGE_ROUTE,
  validateSearch: (search: Record<string, unknown>): { week?: string } => (typeof search.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.week) ? { week: search.week } : {}),
  loaderDeps: ({ search }) => ({ week: search.week }),
  loader: ({ params, deps }) => getKitchenShopping({ data: { kitchenId: params.kitchenId, week: deps.week } }),
  component: () => <KitchenShoppingPage {...Route.useLoaderData()} />
});
