import { faviconLink, favicons } from "../../platform/ui/favicons.js";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { requireProductSession } from "../../platform/auth/session.js";
import { getKitchenLanguage } from "../../products/kitchen/server-functions.js";
import { LanguageProvider } from "../../products/kitchen/ui/language.js";

export const Route = createFileRoute("/kitchen")({
  // The session is checked on entering Kitchen. Every server function checks it again, so page switches skip the extra round trip.
  beforeLoad: ({ location, cause }) => (cause === "enter" ? requireProductSession(location.href, "kitchen") : undefined),
  loader: () => getKitchenLanguage(),
  staleTime: Infinity,
  head: () => ({ meta: [{ title: "Kitchen | Mauroner Tools" }, { name: "robots", content: "noindex, nofollow" }], links: [faviconLink(favicons.kitchen)] }),
  component: KitchenLayout
});

function KitchenLayout() {
  return <LanguageProvider value={Route.useLoaderData()}><Outlet /></LanguageProvider>;
}
