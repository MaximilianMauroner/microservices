import { createFileRoute } from "@tanstack/react-router";
import { PrivateToolsStatus } from "../../features/status/tools-status.js";
import { getPrivateStatusPageData } from "../../protected-data.js";
import { tools } from "../../route-handlers.js";
import { faviconLink, favicons } from "../../favicons.js";

export const Route = createFileRoute("/manage/status")({
  loader: () => getPrivateStatusPageData(),
  head: () => ({
    meta: [
      { title: "Private status — Mauroner Tools" },
      { name: "description", content: "Current availability of private Mauroner tools and services." },
      { name: "robots", content: "noindex, nofollow" }
    ],
    links: [faviconLink(favicons.directory)]
  }),
  component: PrivateStatusRoute,
  server: { handlers: { HEAD: tools } }
});

function PrivateStatusRoute() {
  return <PrivateToolsStatus {...Route.useLoaderData()} />;
}
