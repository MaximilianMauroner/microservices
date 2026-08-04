import { createFileRoute } from "@tanstack/react-router";
import { PrivateToolsStatus } from "../../components/tools-status.js";
import { getPrivateStatusPageData } from "../../protected-data.js";
import { tools } from "../../route-handlers.js";

export const Route = createFileRoute("/manage/status")({
  loader: () => getPrivateStatusPageData(),
  head: () => ({
    meta: [
      { title: "Private status — Mauroner Tools" },
      { name: "description", content: "Current availability of private Mauroner tools and services." },
      { name: "robots", content: "noindex, nofollow" }
    ]
  }),
  component: PrivateStatusRoute,
  server: { handlers: { HEAD: tools } }
});

function PrivateStatusRoute() {
  return <PrivateToolsStatus {...Route.useLoaderData()} />;
}
