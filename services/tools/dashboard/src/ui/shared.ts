import type { MonitorStatus, PublicMonitorStatus } from "@tools-platform/domain";
import {
  renderSuiteChrome,
  type SuiteDestination
} from "@tools-platform/suite-chrome";
import { escapeHtml } from "./escape.js";

export function pageShell(input: {
  title: string;
  description: string;
  body: string;
  operations?: boolean;
  privatePage?: boolean;
  markdownAdmin?: boolean;
  active: SuiteDestination;
  canonicalUrl?: string;
  themeColor?: string;
}): string {
  const script = input.operations
    ? '\n    <script src="/assets/ops.js?v=4b98adb" defer></script>'
    : input.markdownAdmin
      ? '\n    <script src="/assets/markdown-admin.js?v=5e41cd2" defer></script>'
      : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${escapeHtml(input.description)}">
    ${input.operations || input.privatePage ? '<meta name="robots" content="noindex, nofollow">' : input.canonicalUrl ? `<link rel="canonical" href="${escapeHtml(input.canonicalUrl)}">
    <meta property="og:title" content="${escapeHtml(input.title)}">
    <meta property="og:description" content="${escapeHtml(input.description)}">
    <meta property="og:url" content="${escapeHtml(input.canonicalUrl)}">
    <meta property="og:type" content="website">` : ""}
    <meta name="theme-color" content="${escapeHtml(input.themeColor ?? "#000000")}">
    <title>${escapeHtml(input.title)}</title>
    <link rel="icon" href="/favicon.svg?v=90e2a71" type="image/svg+xml">
    <link rel="stylesheet" href="/assets/tools.css?v=e711d2ab9dec">
    <script src="/assets/local-time.js?v=2b6fd61" defer></script>${script}
  </head>
  <body>
    ${renderSuiteChrome(input.active)}
    ${input.body}
  </body>
</html>`;
}

const STATUS_LABELS: Record<MonitorStatus, string> = {
  checking: "Checking",
  up: "Operational",
  down: "Unavailable",
  paused: "Monitoring paused",
  unavailable: "Unavailable from Railway"
};

export function statusBadge(status: PublicMonitorStatus | undefined): string {
  if (!status) {
    return '<span class="status status--unmonitored">Not monitored</span>';
  }
  return `<span class="status status--${status.status}">${STATUS_LABELS[status.status]}</span>`;
}

export function statusDetails(
  status: PublicMonitorStatus | undefined
): string {
  if (!status) {
    return "No automated checks";
  }
  if (status.status === "unavailable") {
    return "This private target cannot be reached by the Railway checker.";
  }
  if (status.status === "paused") {
    return "Automated checks are paused.";
  }
  if (!status.checkedAt) {
    return "Waiting for the first check.";
  }
  const metrics = [
    status.latencyMs === null ? null : `${status.latencyMs} ms`,
    status.statusCode === null ? null : `HTTP ${status.statusCode}`
  ].filter((value): value is string => value !== null);
  return `Checked ${formatTimestamp(status.checkedAt)}${metrics.length > 0 ? ` · ${metrics.join(" · ")}` : ""}`;
}

export function formatTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return escapeHtml(value);
  }
  return escapeHtml(
    new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC"
    }).format(timestamp) + " UTC"
  );
}

export function byOrderThenId<T extends { id: string; order: number }>(
  left: T,
  right: T
): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}
