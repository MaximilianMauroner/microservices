import { createFileRoute } from "@tanstack/react-router";
import { ManagePage } from "../components/manage-page.js";
import { getManagePageData } from "../protected-data.js";
import { tools } from "../route-handlers.js";

export const Route = createFileRoute("/manage")({
  loader: () => getManagePageData(),
  head: () => ({
    meta: [
      { title: "Manage — Mauroner Tools" },
      { name: "description", content: "Protected Tools Platform catalog administration." },
      { name: "robots", content: "noindex, nofollow" }
    ]
  }),
  component: ManageRoute,
  server: { handlers: { HEAD: tools } }
});

function ManageRoute() {
  return <ManagePage initial={Route.useLoaderData()} />;
}
