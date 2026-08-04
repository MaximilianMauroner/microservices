import { createFileRoute } from "@tanstack/react-router";
import { PublishPage } from "../components/publish-page.js";
import { getPublishPageData } from "../protected-data.js";

export const Route = createFileRoute("/publish")({
  loader: () => getPublishPageData(),
  head: () => ({
    meta: [
      { title: "Publish — Mauroner Tools" },
      { name: "description", content: "Upload and share durable artifacts." },
      { name: "robots", content: "noindex, nofollow" }
    ]
  }),
  component: PublishRoute
});

function PublishRoute() {
  return <PublishPage initial={Route.useLoaderData()} />;
}
