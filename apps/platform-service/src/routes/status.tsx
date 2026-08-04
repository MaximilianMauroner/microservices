import { createFileRoute } from "@tanstack/react-router";
import { ToolsStatus } from "../components/tools-status.js";
import { getPublicPageData } from "../public-data.js";
import { tools } from "../route-handlers.js";

export const Route = createFileRoute("/status")({
  head: ({ loaderData }) => ({
    meta: [
      { title: "Status — Mauroner Tools" },
      { name: "description", content: "Current availability of Mauroner tools and services." },
      { name: "theme-color", content: "#000000" },
      { property: "og:title", content: "Status — Mauroner Tools" },
      { property: "og:description", content: "Current availability of Mauroner tools and services." },
      { property: "og:url", content: `${loaderData?.publicOrigin ?? ""}/status` },
      { property: "og:type", content: "website" }
    ],
    links: loaderData ? [{ rel: "canonical", href: `${loaderData.publicOrigin}/status` }] : []
  }),
  loader: () => getPublicPageData(),
  component: ToolsStatusRoute,
  server: { handlers: { HEAD: tools } }
});

function ToolsStatusRoute() {
  const data = Route.useLoaderData();
  return <ToolsStatus {...data} />;
}
