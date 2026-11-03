import { createFileRoute } from "@tanstack/react-router";
import { ManagePage } from "../../../products/publisher/ui/manage-page.js";
import { getManagePageData } from "../../../platform/protected-data.js";

export const Route = createFileRoute("/publisher/artifacts")({
  loader: () => getManagePageData(),
  component: ManageIndexRoute
});

function ManageIndexRoute() {
  return <ManagePage initial={Route.useLoaderData()} />;
}
