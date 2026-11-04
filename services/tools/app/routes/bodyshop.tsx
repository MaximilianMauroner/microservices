import { faviconLink, favicons } from "../../platform/ui/favicons.js";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { requireProductSession } from "../../platform/auth/session.js";
import { BodyshopLayout } from "../../products/bodyshop/ui/kit.js";

export const Route = createFileRoute("/bodyshop")({
  // The session is checked on entering Bodyshop. Every server function checks it again.
  beforeLoad: ({ location, cause }) => (cause === "enter" ? requireProductSession(location.href, "bodyshop") : undefined),
  head: () => ({ meta: [{ title: "Bodyshop | Mauroner Tools" }, { name: "robots", content: "noindex, nofollow" }], links: [faviconLink(favicons.bodyshop)] }),
  component: () => <BodyshopLayout><Outlet /></BodyshopLayout>
});
