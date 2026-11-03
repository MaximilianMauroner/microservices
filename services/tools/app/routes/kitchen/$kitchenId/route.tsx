import { Outlet, createFileRoute } from "@tanstack/react-router";
import { getKitchenFrame } from "../../../../products/kitchen/server-functions.js";
import { KitchenLayout } from "../../../../products/kitchen/ui/kit.js";

export const Route = createFileRoute("/kitchen/$kitchenId")({
  loader: ({ params }) => getKitchenFrame({ data: { kitchenId: params.kitchenId } }),
  staleTime: 60_000,
  component: KitchenFrameRoute
});

function KitchenFrameRoute() {
  return <KitchenLayout frame={Route.useLoaderData()}><Outlet /></KitchenLayout>;
}
