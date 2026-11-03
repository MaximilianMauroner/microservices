import { createFileRoute } from "@tanstack/react-router";
import { getKitchenIngredients } from "../../../../products/kitchen/server-functions.js";
import { KitchenIngredientsPage } from "../../../../products/kitchen/ui/ingredients.js";
import { KITCHEN_PAGE_ROUTE } from "../../../../products/kitchen/ui/kit.js";

export const Route = createFileRoute("/kitchen/$kitchenId/ingredients")({
  ...KITCHEN_PAGE_ROUTE,
  loader: ({ params }) => getKitchenIngredients({ data: { kitchenId: params.kitchenId } }),
  component: () => <KitchenIngredientsPage {...Route.useLoaderData()} />
});
