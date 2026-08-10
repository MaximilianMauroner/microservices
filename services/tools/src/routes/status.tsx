import { createFileRoute } from "@tanstack/react-router";
import { ToolsStatus } from "../../status/ui/tools-status.js";
import { getPrivateStatusPageData } from "../protected-data.js";
import { tools } from "../route-handlers.js";
import { faviconLink, favicons } from "../favicons.js";
import { requireRouteSession } from "../auth-session.js";

export const Route = createFileRoute("/status")({
  beforeLoad: ({ location }) => requireRouteSession(location.href),
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
    links: [
      faviconLink(favicons.directory),
      ...(loaderData ? [{ rel: "canonical", href: `${loaderData.publicOrigin}/status` }] : [])
    ]
  }),
  loader: () => getPrivateStatusPageData(),
  component: ToolsStatusRoute,
  server: { handlers: { HEAD: tools } }
});

function ToolsStatusRoute() {
  const data = Route.useLoaderData();
  return <ToolsStatus snapshot={data.snapshot} publicOrigin={data.publicOrigin} />;
}
