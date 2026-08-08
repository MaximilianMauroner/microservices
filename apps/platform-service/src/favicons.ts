import publisherIcon from "../../../packages/tools-web/public/assets/icons/artifact-publisher.png?url";
import reviewIcon from "../../../packages/tools-web/public/assets/icons/field-guide-console.png?url";
import moneyIcon from "../../../packages/tools-web/public/assets/icons/money-tracker.png?url";
import directoryIcon from "../../../packages/tools-web/public/assets/icons/tools-status-directory.png?url";

export const favicons = {
  directory: directoryIcon,
  money: moneyIcon,
  publisher: publisherIcon,
  review: reviewIcon
} as const;

export function faviconLink(href: string) {
  return { rel: "icon", href, type: "image/png", sizes: "48x48" };
}
