import type { PublicMonitorStatus } from "@tools-platform/domain";

export function resolveBrowserLink(href: string, publicOrigin: string) {
  const destination = new URL(href);
  return destination.origin === new URL(publicOrigin).origin ? `${destination.pathname}${destination.search}${destination.hash}` : href;
}

export function statusDetails(status: PublicMonitorStatus | undefined) {
  if (!status?.checkedAt) return "No recent check";
  return `Checked ${formatTimestamp(status.checkedAt)}`;
}

export function formatTimestamp(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(timestamp) + " UTC";
}
