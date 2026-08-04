import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/manage")({
  head: () => ({
    meta: [
      { title: "Manage — Mauroner Tools" },
      { name: "description", content: "Protected Tools Platform catalog administration." },
      { name: "robots", content: "noindex, nofollow" }
    ]
  }),
  component: ManageLayout
});

function ManageLayout() {
  return <Outlet />;
}
