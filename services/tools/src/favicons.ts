import publisherIcon from "../../../services/tools/dashboard/public/assets/icons/artifact-publisher.png?url";
import reviewIcon from "../../../services/tools/dashboard/public/assets/icons/field-guide-console.png?url";
import moneyIcon from "../../../services/tools/dashboard/public/assets/icons/money-tracker.png?url";
import directoryIcon from "../../../services/tools/dashboard/public/assets/icons/tools-status-directory.png?url";

export const favicons = {
  directory: directoryIcon,
  money: moneyIcon,
  publisher: publisherIcon,
  review: reviewIcon
} as const;

export function faviconLink(href: string) {
  return { rel: "icon", href, type: "image/png", sizes: "48x48" };
}
