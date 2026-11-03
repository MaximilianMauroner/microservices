import { Outlet, createFileRoute } from "@tanstack/react-router";
import { faviconLink, favicons } from "../favicons.js";
import { requireProductSession } from "../auth-session.js";

export const Route = createFileRoute("/publisher")({
  beforeLoad: ({ location }) => requireProductSession(location.href, "publisher"),
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
