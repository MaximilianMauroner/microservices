const PRODUCT_ICON_VERSION = "20260812-2";

export const favicons = {
  directory: `/assets/icons/status.png?v=${PRODUCT_ICON_VERSION}`,
  fieldGuide: `/assets/icons/field-guide.png?v=${PRODUCT_ICON_VERSION}`,
  markdownShare: `/assets/icons/markdown-share.png?v=${PRODUCT_ICON_VERSION}`,
  money: `/assets/icons/money.png?v=${PRODUCT_ICON_VERSION}`,
  networkConsole: `/assets/icons/network-console.png?v=${PRODUCT_ICON_VERSION}`,
  publisher: `/assets/icons/publisher.png?v=${PRODUCT_ICON_VERSION}`,
  status: `/assets/icons/status.png?v=${PRODUCT_ICON_VERSION}`
} as const;

export function faviconLink(href: string) {
  return { rel: "icon", href, type: "image/png", sizes: "64x64" };
}
