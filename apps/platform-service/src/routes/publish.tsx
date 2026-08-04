import { createFileRoute } from "@tanstack/react-router";
import { PublishPage } from "../components/publish-page.js";
import { getPublishPageData } from "../protected-data.js";
import { artifact } from "../route-handlers.js";

export const Route = createFileRoute("/publish")({
  loader: () => getPublishPageData(),
  head: () => ({
    meta: [
      { title: "Publish — Mauroner Tools" },
      { name: "description", content: "Upload and share durable artifacts." },
      { name: "robots", content: "noindex, nofollow" }
    ]
  }),
  component: PublishRoute,
  server: { handlers: { HEAD: artifact } }
});

function PublishRoute() {
  return <PublishPage initial={Route.useLoaderData()} />;
}
