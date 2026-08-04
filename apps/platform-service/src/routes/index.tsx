import { createFileRoute } from "@tanstack/react-router";
import { ToolsDirectory } from "../components/tools-directory.js";
import { getPublicPageData } from "../public-data.js";
import { tools } from "../route-handlers.js";

export const Route = createFileRoute("/")({
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
    links: loaderData ? [{ rel: "canonical", href: `${loaderData.publicOrigin}/` }] : []
  }),
  loader: () => getPublicPageData(),
  component: ToolsDirectoryRoute,
  server: {
    handlers: {
      HEAD: tools
    }
  }
});

function ToolsDirectoryRoute() {
  const data = Route.useLoaderData();
  return <ToolsDirectory {...data} />;
}
