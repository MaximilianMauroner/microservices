import { Outlet, createFileRoute } from "@tanstack/react-router";
import { faviconLink, favicons } from "../favicons.js";

export const Route = createFileRoute("/feedback")({
  head: () => ({ meta: [{ title: "Feedback | Mauroner Tools" }, { name: "robots", content: "noindex, nofollow" }], links: [faviconLink(favicons.feedback)] }),
  component: Outlet
});
