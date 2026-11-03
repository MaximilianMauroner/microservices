import { createFileRoute } from "@tanstack/react-router";
import { KitchenPage } from "../../kitchen/kitchen-page.js";
import { requireProductSession } from "../auth-session.js";

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
