import { favicons } from "../favicons.js";

export type ToolsPage = Readonly<{ label: string; to: string; match: (path: string) => boolean; external?: true }>;
export type ToolsProduct = Readonly<{
  id: "dashboard" | "publisher" | "money" | "feedback" | "markdown" | "status";
  label: string;
  to: string;
  icon: string;
  match: (path: string) => boolean;
  pages?: readonly ToolsPage[];
}>;

const exact = (to: string) => (path: string) => path === to || path === `${to}/`;

/** The sidebar and the phone tabs read the same list, so a page is only ever listed once. */
export const TOOLS_PRODUCTS: readonly ToolsProduct[] = [
  { id: "dashboard", label: "Dashboard", to: "/", icon: favicons.directory, match: (path) => path === "/" },
  {
    id: "publisher", label: "Publisher", to: "/publisher", icon: favicons.publisher, match: (path) => path.startsWith("/publisher"),
    pages: [
      { label: "Publish", to: "/publisher", match: exact("/publisher") },
      { label: "Library", to: "/publisher/artifacts", match: exact("/publisher/artifacts") },
      { label: "Receive files", to: "/publisher/receive", match: exact("/publisher/receive") }
    ]
  },
  { id: "money", label: "Money", to: "/money", icon: favicons.money, match: (path) => path.startsWith("/money") },
  {
    id: "feedback", label: "Feedback", to: "/feedback", icon: favicons.feedback, match: (path) => path.startsWith("/feedback"),
    pages: [
      { label: "Responses", to: "/feedback", match: (path) => exact("/feedback")(path) || path.startsWith("/feedback/responses") },
      { label: "Forms", to: "/feedback/forms", match: (path) => path.startsWith("/feedback/forms") }
    ]
  },
  {
    id: "markdown", label: "Markdown Share", to: "/documents", icon: favicons.markdownShare, match: (path) => path === "/documents",
    pages: [
      { label: "Documents", to: "/documents", match: exact("/documents") },
      { label: "Editor", to: "/markdown", match: () => false, external: true }
    ]
  },
  { id: "status", label: "Status", to: "/status", icon: favicons.status, match: (path) => path.startsWith("/status") }
];

export function currentProduct(pathname: string) {
  return TOOLS_PRODUCTS.find((product) => product.match(pathname));
}
