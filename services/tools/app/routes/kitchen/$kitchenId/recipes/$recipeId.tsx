import { createFileRoute } from "@tanstack/react-router";
import { getKitchenRecipe } from "../../../../../products/kitchen/server-functions.js";
import { KitchenRecipePage } from "../../../../../products/kitchen/ui/recipes.js";
import { KITCHEN_PAGE_ROUTE } from "../../../../../products/kitchen/ui/kit.js";

export const Route = createFileRoute("/kitchen/$kitchenId/recipes/$recipeId")({
  ...KITCHEN_PAGE_ROUTE,
  loader: ({ params }) => getKitchenRecipe({ data: { kitchenId: params.kitchenId, recipeId: params.recipeId } }),
  component: () => <KitchenRecipePage key={Route.useParams().recipeId} {...Route.useLoaderData()} />
});
