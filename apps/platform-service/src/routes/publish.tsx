import { createFileRoute } from "@tanstack/react-router";
import { PublishPage } from "../features/publish/publish-page.js";
import { faviconLink, favicons } from "../favicons.js";
import { requireRouteSession } from "../auth-session.js";

export const Route = createFileRoute("/publish")({
  beforeLoad: ({ location }) => requireRouteSession(location.href),
  head: () => ({
    meta: [
      { title: "Publish — Mauroner Tools" },
      { name: "description", content: "Upload and share temporary files." },
      { name: "robots", content: "noindex, nofollow" }
    ],
    links: [faviconLink(favicons.publisher)]
  }),
  component: PublishRoute
});

function PublishRoute() {
  return <PublishPage />;
}
