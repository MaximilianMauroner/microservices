import { Outlet, createFileRoute } from "@tanstack/react-router";
import { MarkdownShareClient } from "../../markdown-share/client.js";
import markdownShareStyles from "../../markdown-share/styles.css?url";
import { faviconLink, favicons } from "../favicons.js";

export const Route = createFileRoute("/share")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Document Share" },
      { name: "description", content: "A collaborative Markdown and LaTeX source workspace." },
      { name: "robots", content: "noindex, nofollow" },
      { name: "theme-color", content: "#f4f0e8", media: "(prefers-color-scheme: light)" },
      { name: "theme-color", content: "#161514", media: "(prefers-color-scheme: dark)" },
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
