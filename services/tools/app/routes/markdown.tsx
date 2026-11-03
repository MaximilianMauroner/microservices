import { Outlet, createFileRoute } from "@tanstack/react-router";
import markdownShareStyles from "../../products/documents/styles.css?url";
import { faviconLink, favicons } from "../../platform/ui/favicons.js";

export const Route = createFileRoute("/markdown")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Document Share" },
      { name: "description", content: "A seven-day collaborative Markdown workspace." },
      { name: "robots", content: "noindex, nofollow" },
      { name: "theme-color", content: "#fafafa", media: "(prefers-color-scheme: light)" },
      { name: "theme-color", content: "#000000", media: "(prefers-color-scheme: dark)" },
    ],
    links: [
      faviconLink(favicons.markdownShare),
      { rel: "stylesheet", href: markdownShareStyles },
    ],
  }),
  component: Outlet,
});
