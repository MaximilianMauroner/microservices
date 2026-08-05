import { createFileRoute } from "@tanstack/react-router";
import { ManagePage } from "../../components/manage-page.js";
import { getManagePageData } from "../../protected-data.js";

export const Route = createFileRoute("/manage/")({
  loader: () => getManagePageData(),
  component: ManageIndexRoute
});

function ManageIndexRoute() {
  return <ManagePage initial={Route.useLoaderData()} />;
}
