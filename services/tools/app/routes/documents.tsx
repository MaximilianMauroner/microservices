import { createFileRoute } from "@tanstack/react-router";
import { DocumentsPage } from "../../products/dashboard/ui/documents-page.js";
import { getDocumentsPageData } from "../../platform/protected-data.js";
import { requireProductSession } from "../../platform/auth/session.js";
import { faviconLink, favicons } from "../../platform/ui/favicons.js";

export const Route = createFileRoute("/documents")({
  beforeLoad: ({ location }) => requireProductSession(location.href, "markdown"),
  loader: () => getDocumentsPageData(),
  head: () => ({
    meta: [
      { title: "Documents — Mauroner Tools" },
      { name: "description", content: "Protected Document Share document inventory." },
      { name: "robots", content: "noindex, nofollow" }
    ],
    links: [faviconLink(favicons.markdownShare)]
  }),
  component: DocumentsRoute
});

function DocumentsRoute() {
  return <DocumentsPage initial={Route.useLoaderData()} />;
}
