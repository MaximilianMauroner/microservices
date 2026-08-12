export const favicons = {
  directory: "/assets/icons/status.png",
  fieldGuide: "/assets/icons/field-guide.png",
  markdownShare: "/assets/icons/markdown-share.png",
  money: "/assets/icons/money.png",
  networkConsole: "/assets/icons/network-console.png",
  publisher: "/assets/icons/publisher.png",
  status: "/assets/icons/status.png"
} as const;

export function faviconLink(href: string) {
  return { rel: "icon", href, type: "image/png", sizes: "48x48" };
}
