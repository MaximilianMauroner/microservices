import { createFileRoute } from "@tanstack/react-router";
import { ToolsDirectory } from "../features/catalog/tools-directory.js";
import { getPrivateStatusPageData } from "../protected-data.js";
import { tools } from "../route-handlers.js";
import { faviconLink, favicons } from "../favicons.js";
import { requireRouteSession } from "../auth-session.js";

export const Route = createFileRoute("/")({
  beforeLoad: ({ location }) => requireRouteSession(location.href),
  head: ({ loaderData }) => ({
    meta: [
      { title: "Mauroner Tools" },
      { name: "description", content: "Publishing, review, status, and operations tools." },
      { name: "theme-color", content: "#000000" },
      { property: "og:title", content: "Mauroner Tools" },
      { property: "og:description", content: "Publishing, review, status, and operations tools." },
      { property: "og:url", content: `${loaderData?.publicOrigin ?? ""}/` },
      { property: "og:type", content: "website" }
    ],
    links: [
      faviconLink(favicons.directory),
      ...(loaderData ? [{ rel: "canonical", href: `${loaderData.publicOrigin}/` }] : [])
    ]
  }),
  loader: () => getPrivateStatusPageData(),
  component: ToolsDirectoryRoute,
  server: {
    handlers: {
      HEAD: tools
    }
  }
});

function ToolsDirectoryRoute() {
  const data = Route.useLoaderData();
  return <ToolsDirectory snapshot={data.snapshot} publicOrigin={data.publicOrigin} />;
}
