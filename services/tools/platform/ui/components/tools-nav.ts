import { favicons } from "../favicons.js";

export type ToolsPage = Readonly<{ label: string; to: string; match: (path: string) => boolean; external?: true }>;
export type ToolsProduct = Readonly<{
  id: "dashboard" | "publisher" | "money" | "feedback" | "markdown" | "kitchen" | "bodyshop" | "status";
  label: string;
  description?: string;
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
      { label: "Family QR", to: "/publisher/qr", match: exact("/publisher/qr") },
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
    id: "markdown", label: "Document Share", to: "/documents", icon: favicons.markdownShare, match: (path) => path === "/documents",
    pages: [
      { label: "Documents", to: "/documents", match: exact("/documents") },
      { label: "Editor", to: "/share", match: () => false, external: true }
    ]
  },
  { id: "kitchen", label: "Kitchen", description: "Recipes and meal planning", to: "/kitchen", icon: favicons.kitchen, match: (path) => path.startsWith("/kitchen") },
  {
    id: "bodyshop", label: "Bodyshop", description: "Food and weight log", to: "/bodyshop", icon: favicons.bodyshop, match: (path) => path.startsWith("/bodyshop"),
    pages: [
      { label: "Today", to: "/bodyshop", match: exact("/bodyshop") },
      { label: "Progress", to: "/bodyshop/progress", match: exact("/bodyshop/progress") },
      { label: "Foods", to: "/bodyshop/foods", match: exact("/bodyshop/foods") },
      { label: "Settings", to: "/bodyshop/settings", match: exact("/bodyshop/settings") }
    ]
  },
  { id: "status", label: "Status", to: "/status", icon: favicons.status, match: (path) => path.startsWith("/status") }
];

export function currentProduct(pathname: string) {
  return TOOLS_PRODUCTS.find((product) => product.match(pathname));
}

export const EXTERNAL_TOOLS = [
  { id: "network-console", label: "Network Console", to: "https://coding.tailbc92d.ts.net", icon: favicons.networkConsole }
] as const;
