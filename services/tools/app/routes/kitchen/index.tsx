import { createFileRoute, redirect } from "@tanstack/react-router";
import { getKitchens } from "../../../products/kitchen/server-functions.js";
import { KitchensPage } from "../../../products/kitchen/ui/kitchens.js";

export const Route = createFileRoute("/kitchen/")({
  validateSearch: (search: Record<string, unknown>): { all?: boolean } => (search.all === true || search.all === "true" ? { all: true } : {}),
  loaderDeps: ({ search }) => ({ all: search.all === true }),
  loader: async ({ deps }) => {
    const data = await getKitchens();
    const [only] = data.kitchens;
    if (!deps.all && only && data.kitchens.length === 1) throw redirect({ to: "/kitchen/$kitchenId", params: { kitchenId: only.id } });
    return data;
  },
  component: () => <KitchensPage {...Route.useLoaderData()} />
});
