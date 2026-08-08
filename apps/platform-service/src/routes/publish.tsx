import { createFileRoute } from "@tanstack/react-router";
import { PublishPage } from "../features/publish/publish-page.js";
import { getPublishPageData } from "../protected-data.js";
import { faviconLink, favicons } from "../favicons.js";
import { requireRouteSession } from "../auth-session.js";

export const Route = createFileRoute("/publish")({
  beforeLoad: ({ location }) => requireRouteSession(location.href),
  loader: () => getPublishPageData(),
  head: () => ({
    meta: [
      { title: "Publish — Mauroner Tools" },
      { name: "description", content: "Upload and share durable artifacts." },
      { name: "robots", content: "noindex, nofollow" }
    ],
    links: [faviconLink(favicons.publisher)]
  }),
  component: PublishRoute
});

function PublishRoute() {
  return <PublishPage initial={Route.useLoaderData()} />;
}
