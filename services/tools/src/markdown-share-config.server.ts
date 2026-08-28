import { loadMarkdownShareClientConfig } from "../markdown-share/client-config.js";

/** Server-owned Markdown Share configuration, validated during process startup. */
export const markdownShareClientConfig = loadMarkdownShareClientConfig(
  process.env.VITE_CONVEX_URL
);
