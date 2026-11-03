import { createFileRoute } from "@tanstack/react-router";
import { getBodyshopFoods } from "../../../products/bodyshop/server-functions.js";
import { FoodsPage } from "../../../products/bodyshop/ui/foods.js";

export const Route = createFileRoute("/bodyshop/foods")({
  loader: () => getBodyshopFoods(),
  component: () => <FoodsPage foods={Route.useLoaderData()} />
});
