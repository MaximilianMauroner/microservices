import { createFileRoute } from "@tanstack/react-router";
import { DocumentsPage } from "../../components/documents-page.js";
import { getDocumentsPageData } from "../../protected-data.js";

export const Route = createFileRoute("/manage/documents")({
  loader: () => getDocumentsPageData(),
  head: () => ({
    meta: [
      { title: "Documents — Mauroner Tools" },
      { name: "description", content: "Protected Markdown Share document inventory." },
      { name: "robots", content: "noindex, nofollow" }
    ]
  }),
  component: DocumentsRoute
});

function DocumentsRoute() {
  return <DocumentsPage initial={Route.useLoaderData()} />;
}
