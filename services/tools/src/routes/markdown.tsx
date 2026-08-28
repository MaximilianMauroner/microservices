import { Outlet, createFileRoute } from "@tanstack/react-router";
import { MarkdownShareClient } from "../../markdown-share/client.js";
import markdownShareStyles from "../../markdown-share/styles.css?url";
import { faviconLink, favicons } from "../favicons.js";

export const Route = createFileRoute("/markdown")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Markdown Share" },
      { name: "description", content: "A seven-day collaborative Markdown workspace." },
      { name: "robots", content: "noindex, nofollow" },
      { name: "theme-color", content: "#f4f0e8" },
    ],
    links: [
      faviconLink(favicons.markdownShare),
      { rel: "stylesheet", href: markdownShareStyles },
    ],
  }),
  component: MarkdownShareLayout,
});

function MarkdownShareLayout() {
  return <MarkdownShareClient><Outlet /></MarkdownShareClient>;
}
