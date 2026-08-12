import fieldGuide from "../dashboard/public/assets/icons/field-guide.png?url&no-inline";
import markdownShare from "../dashboard/public/assets/icons/markdown-share.png?url&no-inline";
import money from "../dashboard/public/assets/icons/money.png?url&no-inline";
import networkConsole from "../dashboard/public/assets/icons/network-console.png?url&no-inline";
import publisher from "../dashboard/public/assets/icons/publisher.png?url&no-inline";
import status from "../dashboard/public/assets/icons/status.png?url&no-inline";
import tools from "../dashboard/public/assets/icons/tools.png?url&no-inline";

export const favicons = {
  directory: tools,
  fieldGuide,
  markdownShare,
  money,
  networkConsole,
  publisher,
  status
} as const;

export function faviconLink(href: string) {
  return { rel: "icon", href, type: "image/png", sizes: "96x96" };
}
