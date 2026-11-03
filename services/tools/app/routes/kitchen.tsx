import { createFileRoute } from "@tanstack/react-router";
import { KitchenPage } from "../../products/kitchen/kitchen-page.js";
import { requireProductSession } from "../../platform/auth/session.js";

export const Route = createFileRoute("/kitchen")({
  beforeLoad: ({ location }) => requireProductSession(location.href, "kitchen"),
  head: () => ({
    meta: [
      { title: "Kitchen — Tools" },
      { name: "robots", content: "noindex, nofollow" }
    ]
  }),
  component: KitchenPage
});
