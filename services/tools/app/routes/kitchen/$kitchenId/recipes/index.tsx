import { createFileRoute } from "@tanstack/react-router";
import { getKitchenRecipes } from "../../../../../products/kitchen/server-functions.js";
import { KitchenRecipesPage } from "../../../../../products/kitchen/ui/recipes.js";
import { KITCHEN_PAGE_ROUTE } from "../../../../../products/kitchen/ui/kit.js";

export const Route = createFileRoute("/kitchen/$kitchenId/recipes/")({
  ...KITCHEN_PAGE_ROUTE,
  loader: ({ params }) => getKitchenRecipes({ data: { kitchenId: params.kitchenId } }),
  component: () => <KitchenRecipesPage {...Route.useLoaderData()} />
});
