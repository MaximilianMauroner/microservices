export const favicons = {
  directory: "/assets/icons/tools-status-directory.png",
  money: "/assets/icons/money-tracker.png",
  publisher: "/assets/icons/artifact-publisher.png",
  review: "/assets/icons/field-guide-console.png"
} as const;

export function faviconLink(href: string) {
  return { rel: "icon", href, type: "image/png", sizes: "48x48" };
}
