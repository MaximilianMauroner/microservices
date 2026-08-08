import { Outlet, createFileRoute } from "@tanstack/react-router";
import { faviconLink, favicons } from "../favicons.js";
import { requireRouteSession } from "../auth-session.js";

export const Route = createFileRoute("/manage")({
  beforeLoad: ({ location }) => requireRouteSession(location.href),
  head: () => ({
    meta: [
      { title: "Manage — Mauroner Tools" },
      { name: "description", content: "Maintain published artifacts and temporary files." },
      { name: "robots", content: "noindex, nofollow" }
    ],
    links: [faviconLink(favicons.directory)]
  }),
  component: ManageLayout
});

function ManageLayout() {
  return <Outlet />;
}
