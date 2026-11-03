import { createFileRoute } from "@tanstack/react-router";
import { getKitchenPantry } from "../../../../products/kitchen/server-functions.js";
import { KitchenPantryPage } from "../../../../products/kitchen/ui/pantry.js";
import { KITCHEN_PAGE_ROUTE } from "../../../../products/kitchen/ui/kit.js";

export const Route = createFileRoute("/kitchen/$kitchenId/home")({
  ...KITCHEN_PAGE_ROUTE,
  loader: ({ params }) => getKitchenPantry({ data: { kitchenId: params.kitchenId } }),
  component: () => <KitchenPantryPage {...Route.useLoaderData()} />
});
