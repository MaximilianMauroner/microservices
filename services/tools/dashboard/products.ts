export type ProductAccent = "lime" | "violet" | "amber" | "cyan" | "rose" | "blue";

export type ProductDefinition = Readonly<{
  id: string;
  name: string;
  description: string;
  href: string;
  access: "private" | "public" | "tailnet";
  accent: ProductAccent;
  monitorId?: string;
  external: boolean;
}>;

/** Product identity and navigation are deployed with the monolith, not stored as runtime data. */
export const products = [
  { id: "publisher", name: "Publisher", description: "Publish durable plans and files.", href: "/publisher", access: "private", accent: "violet", monitorId: "tools", external: false },
  { id: "field-guide", name: "Field Guide", description: "Review decisions and maintain lessons.", href: "/field-guide", access: "private", accent: "amber", monitorId: "tools", external: false },
  { id: "money", name: "Money", description: "Track accounts, changes, and net worth.", href: "/money", access: "private", accent: "lime", monitorId: "tools", external: false },
  { id: "status", name: "Status", description: "Availability, incidents, and heartbeats.", href: "/status", access: "private", accent: "cyan", monitorId: "tools", external: false },
  { id: "markdown-share", name: "Markdown Share", description: "Share rendered Markdown documents.", href: "https://md.mauroner.net", access: "public", accent: "rose", monitorId: "markdown-share", external: true },
  { id: "network-console", name: "Network Console", description: "Inspect private network services.", href: "https://network.mauroner.net", access: "tailnet", accent: "blue", monitorId: "network-console", external: true }
] as const satisfies readonly ProductDefinition[];

export type ProductId = (typeof products)[number]["id"];
