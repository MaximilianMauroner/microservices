import { Outlet, createFileRoute } from "@tanstack/react-router";
import { faviconLink, favicons } from "../favicons.js";
import { requireRouteSession } from "../auth-session.js";

export const Route = createFileRoute("/publisher")({
  beforeLoad: ({ location }) => requireRouteSession(location.href),
  head: () => ({
    meta: [
      { title: "Publisher — Tools" },
      { name: "description", content: "Publish and maintain shared artifacts." },
      { name: "robots", content: "noindex, nofollow" }
    ],
    links: [faviconLink(favicons.publisher)]
  }),
  component: Outlet
});
