import { createFileRoute } from "@tanstack/react-router";
import { DocumentsPage } from "../../dashboard/ui/documents-page.js";
import { getDocumentsPageData } from "../protected-data.js";
import { requireRouteSession } from "../auth-session.js";
import { faviconLink, favicons } from "../favicons.js";

export const Route = createFileRoute("/documents")({
  beforeLoad: ({ location }) => requireRouteSession(location.href),
  loader: () => getDocumentsPageData(),
  head: () => ({
    meta: [
      { title: "Documents — Mauroner Tools" },
      { name: "description", content: "Protected Markdown Share document inventory." },
      { name: "robots", content: "noindex, nofollow" }
    ],
    links: [faviconLink(favicons.markdownShare)]
  }),
  component: DocumentsRoute
});

function DocumentsRoute() {
  return <DocumentsPage initial={Route.useLoaderData()} />;
}
