import { createFileRoute } from "@tanstack/react-router";
import { ManagePage } from "../../../publisher/ui/manage-page.js";
import { getManagePageData } from "../../protected-data.js";

export const Route = createFileRoute("/publisher/artifacts")({
  loader: () => getManagePageData(),
  component: ManageIndexRoute
});

function ManageIndexRoute() {
  return <ManagePage initial={Route.useLoaderData()} />;
}
