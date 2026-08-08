import { Outlet, createFileRoute } from "@tanstack/react-router";
import { faviconLink, favicons } from "../favicons.js";

export const Route = createFileRoute("/manage")({
  head: () => ({
    meta: [
      { title: "Manage — Mauroner Tools" },
      { name: "description", content: "Protected Tools Platform catalog administration." },
      { name: "robots", content: "noindex, nofollow" }
    ],
    links: [faviconLink(favicons.directory)]
  }),
  component: ManageLayout
});

function ManageLayout() {
  return <Outlet />;
}
