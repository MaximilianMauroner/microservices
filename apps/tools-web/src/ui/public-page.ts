import type {
  MonitorStatus,
  PublicCatalogEntry,
  PublicMonitorStatus,
  PublicSnapshotDocument
} from "@tools-platform/domain";
import { escapeHtml, safeHttpUrl } from "./escape.js";
import {
  byOrderThenId,
  formatTimestamp,
  pageShell,
  statusBadge,
  statusDetails as directoryStatusDetails
} from "./shared.js";

type OverallState = "operational" | "attention" | "outage" | "unknown";

const STATUS_LABELS: Record<MonitorStatus, string> = {
  checking: "Checking",
  up: "Operational",
  down: "Unavailable",
  paused: "Monitoring paused",
  unavailable: "Not checkable from Railway"
};

export function renderPublicPage(snapshot: PublicSnapshotDocument): string {
  const groups = [...snapshot.groups].sort(byOrderThenId);
  const entries = [...snapshot.entries].sort(byOrderThenId);
  const body = `<main id="main" class="tools-home">
      <section class="tools-intro wrap" aria-labelledby="tools-title">
        <p class="eyebrow">Useful, focused services</p>
        <h1 id="tools-title">Tools for publishing, review, and operations.</h1>
        <p class="lede">A curated directory of Mauroner services, with clear access requirements and live availability.</p>
        <p class="freshness">Catalog updated <time datetime="${escapeHtml(snapshot.generatedAt)}">${formatTimestamp(snapshot.generatedAt)}</time></p>
      </section>
      <section class="catalog wrap" aria-label="Tool directory">
        ${groups.length === 0 ? directoryEmptyState() : groups.map((group, index) => {
          const groupEntries = entries.filter((entry) => entry.groupId === group.id);
          if (groupEntries.length === 0) return "";
          return `<section class="catalog-group" aria-labelledby="group-${escapeHtml(group.id)}">
            <header class="group-header">
              <p class="group-index">${String(index + 1).padStart(2, "0")}</p>
              <div>
                <h2 id="group-${escapeHtml(group.id)}">${escapeHtml(group.name)}</h2>
                ${group.description ? `<p>${escapeHtml(group.description)}</p>` : ""}
              </div>
            </header>
            <ul class="tool-grid" role="list">${groupEntries.map((entry) => renderToolCard(entry, snapshot.statuses[entry.id])).join("")}</ul>
          </section>`;
        }).join("")}
      </section>
    </main>
    <footer class="site-footer"><div class="wrap">Mauroner Tools · Availability updates every five minutes</div></footer>`;
  return pageShell({
    title: "Mauroner Tools",
    description: "Publishing, review, status, and operations tools.",
    body,
    active: "tools"
  });
}

export function renderStatusPage(snapshot: PublicSnapshotDocument): string {
  const entries = [...snapshot.entries].sort(byOrderThenId);
  const overall = overallState(entries, snapshot.statuses);
  const summary = overallSummary(overall);
  const body = `<div class="status-page status-page--${overall}">
    <main id="main" class="status-wrap status-main">
      <section class="status-hero" aria-labelledby="status-title">
        ${statusMark(overall, true)}
        <h1 id="status-title">${summary.title}</h1>
        <p>${summary.detail}</p>
        <p class="status-updated">Last updated <time datetime="${escapeHtml(snapshot.generatedAt)}">${formatTimestamp(snapshot.generatedAt)}</time></p>
      </section>
      <section id="services" class="status-card" aria-labelledby="services-title">
        <header class="status-card__header">
          <h2 id="services-title">Current status by service</h2>
          <span class="overall-badge overall-badge--${overall}">${statusMark(overall, false)}${summary.badge}</span>
        </header>
        ${entries.length === 0 ? emptyState() : `<ul class="service-list" role="list">${entries.map((entry) => renderEntry(entry, snapshot.statuses[entry.id], snapshot.generatedAt)).join("")}</ul>`}
      </section>
    </main>
    <footer class="status-footer">
      <div class="status-wrap"><span class="footer-mark" aria-hidden="true">M</span><span>Managed by Mauroner</span><span aria-hidden="true">·</span><span>Five-minute checks</span></div>
    </footer>
  </div>`;

  return pageShell({
    title: "Status — Mauroner Tools",
    description: "Current availability of Mauroner tools and services.",
    body,
    active: "status"
  });
}

function renderToolCard(
  entry: PublicCatalogEntry,
  status: PublicMonitorStatus | undefined
): string {
  const accessLabels = entry.id === "network-console"
    ? ["Tailscale required"]
    : [
        ...(entry.links.some((link) => link.access === "public") ? ["Public"] : []),
        ...(entry.links.some((link) => link.access === "restricted")
          ? ["Cloudflare Access"]
          : [])
      ];
  if (accessLabels.length === 0) accessLabels.push("Public");
  const accessClass = entry.id === "network-console"
    ? "tailscale"
    : accessLabels.includes("Public")
      ? "public"
      : "access";
  const links = entry.links
    .map((link) => {
      const url = safeHttpUrl(link.url);
      if (!url) return "";
      return `<a class="tool-link" href="${escapeHtml(url)}" rel="noreferrer">${escapeHtml(link.label)}<span aria-hidden="true">↗</span></a>`;
    })
    .filter(Boolean)
    .join("");
  return `<li class="tool-card">
      <div class="tool-card__top">
        <div>
          <p class="access-label access-label--${accessClass}">${accessLabels.includes("Cloudflare Access") ? '<span class="suite-lock" aria-hidden="true"></span>' : ""}${escapeHtml(accessLabels.join(" · "))}</p>
          <h3>${escapeHtml(entry.name)}</h3>
        </div>
        ${statusBadge(status)}
      </div>
      <p>${escapeHtml(entry.description)}</p>
      <p class="status-detail">${escapeHtml(directoryStatusDetails(status))}</p>
      ${links ? `<div class="tool-links" aria-label="${escapeHtml(entry.name)} links">${links}</div>` : '<p class="no-link">No browser entry point is published.</p>'}
    </li>`;
}

function directoryEmptyState(): string {
  return '<div class="empty-state"><h2>No tools published yet</h2><p>The public catalog is ready for its first entry.</p></div>';
}

function renderEntry(
  entry: PublicCatalogEntry,
  status: PublicMonitorStatus | undefined,
  generatedAt: string
): string {
  const state = serviceState(status);
  const uptime = uptimeSummary(status, generatedAt);
  const links = entry.links
    .map((link) => {
      const url = safeHttpUrl(link.url);
      if (!url) {
        return "";
      }
      const access = link.access === "restricted"
        ? `<span class="service-access">${entry.id === "network-console" ? "Tailscale required" : "Access protected"}</span>`
        : "";
      return `<a class="service-link" href="${escapeHtml(url)}" rel="noreferrer"><span>${escapeHtml(link.label)}</span>${access}<span aria-hidden="true">↗</span></a>`;
    })
    .filter(Boolean)
    .join("");

  return `<li class="service-row">
    <div class="service-heading">
      <div>
        ${statusMark(state, false)}
        <h3>${escapeHtml(entry.name)}</h3>
      </div>
      <span class="service-state service-state--${state}">${uptime.label}</span>
    </div>
    <p class="service-description">${escapeHtml(entry.description)}</p>
    ${uptimeBar(status, generatedAt, uptime)}
    <div class="service-meta">
      <span>90 days ago</span>
      <span>${uptime.totalChecks > 0 ? `${uptime.totalChecks} checks · ` : ""}${statusDetails(status)}</span>
      <span>Today</span>
    </div>
    ${links ? `<div class="service-links" aria-label="${escapeHtml(entry.name)} links">${links}</div>` : ""}
  </li>`;
}

function uptimeBar(
  status: PublicMonitorStatus | undefined,
  generatedAt: string,
  summary: UptimeSummary
): string {
  const knownDays = new Map(
    (status?.uptimeDays ?? []).map((day) => [day.day, day])
  );
  const bars = rollingDays(generatedAt).map((day) => {
    const uptime = knownDays.get(day);
    const state = uptime === undefined
      ? "unknown"
      : uptime.successfulChecks === uptime.totalChecks
        ? "operational"
        : uptime.successfulChecks === 0
          ? "outage"
          : "attention";
    const title = uptime === undefined
      ? `${day}: no checks recorded`
      : `${day}: ${formatPercentage(uptime.successfulChecks, uptime.totalChecks)} uptime across ${uptime.totalChecks} checks`;
    return `<span class="uptime-day uptime-day--${state}" title="${escapeHtml(title)}" aria-hidden="true"></span>`;
  }).join("");
  const label = summary.percentage === null
    ? `90-day uptime is not available. Latest monitor state: ${status ? STATUS_LABELS[status.status] : "not monitored"}.`
    : `90-day uptime: ${summary.label} across ${summary.totalChecks} checks.`;
  return `<div class="uptime-bar" role="img" aria-label="${escapeHtml(label)}"><span class="visually-hidden">${escapeHtml(label)}</span>${bars}</div>`;
}

interface UptimeSummary {
  label: string;
  percentage: number | null;
  totalChecks: number;
}

function uptimeSummary(
  status: PublicMonitorStatus | undefined,
  generatedAt: string
): UptimeSummary {
  const rollingWindow = new Set(rollingDays(generatedAt));
  const totals = (status?.uptimeDays ?? [])
    .filter(({ day }) => rollingWindow.has(day))
    .reduce(
      (result, day) => ({
        successfulChecks: result.successfulChecks + day.successfulChecks,
        totalChecks: result.totalChecks + day.totalChecks
      }),
      { successfulChecks: 0, totalChecks: 0 }
    );
  if (totals.totalChecks === 0) {
    const label = status === undefined
      ? "Not monitored"
      : status.status === "unavailable"
        ? "Not measured"
        : status.status === "down"
          ? "Unavailable"
          : status.status === "checking"
            ? "Checking"
            : status.status === "paused"
              ? "Monitoring paused"
              : "Collecting uptime";
    return {
      label,
      percentage: null,
      totalChecks: 0
    };
  }
  return {
    label: `${formatPercentage(totals.successfulChecks, totals.totalChecks)} uptime`,
    percentage: (totals.successfulChecks / totals.totalChecks) * 100,
    totalChecks: totals.totalChecks
  };
}

function formatPercentage(successfulChecks: number, totalChecks: number): string {
  const percentage = (successfulChecks / totalChecks) * 100;
  return percentage === 100
    ? "100%"
    : `${percentage.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

function rollingDays(generatedAt: string): string[] {
  const end = new Date(generatedAt);
  end.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: 90 }, (_, index) => {
    const day = new Date(end);
    day.setUTCDate(day.getUTCDate() - (89 - index));
    return day.toISOString().slice(0, 10);
  });
}

function statusDetails(status: PublicMonitorStatus | undefined): string {
  if (!status) {
    return "No automated check";
  }
  if (!status.checkedAt) {
    return status.status === "unavailable"
      ? "Not checkable from Railway"
      : "Awaiting first check";
  }
  const metrics = [
    status.latencyMs === null ? null : `${status.latencyMs} ms`,
    status.statusCode === null ? null : `HTTP ${status.statusCode}`
  ].filter((value): value is string => value !== null);
  return `Latest check <time datetime="${escapeHtml(status.checkedAt)}">${formatTimestamp(status.checkedAt)}</time>${metrics.length > 0 ? ` · ${metrics.join(" · ")}` : ""}`;
}

function serviceState(
  status: PublicMonitorStatus | undefined
): OverallState {
  if (!status) {
    return "unknown";
  }
  if (status.status === "down") {
    return "outage";
  }
  if (status.status === "checking") {
    return "attention";
  }
  if (status.status === "up") {
    return "operational";
  }
  return "unknown";
}

function overallState(
  entries: PublicCatalogEntry[],
  statuses: PublicSnapshotDocument["statuses"]
): OverallState {
  const monitored = entries.map(({ id }) => statuses[id]).filter(
    (status): status is PublicMonitorStatus => status !== undefined
  );
  if (monitored.some(({ status }) => status === "down")) {
    return "outage";
  }
  if (monitored.some(({ status }) => status === "checking")) {
    return "attention";
  }
  if (
    entries.length > 0 &&
    monitored.length === entries.length &&
    monitored.every(({ status }) => status === "up")
  ) {
    return "operational";
  }
  return "unknown";
}

function overallSummary(state: OverallState): {
  title: string;
  detail: string;
  badge: string;
} {
  if (state === "outage") {
    return {
      title: "Some services are unavailable",
      detail: "The monitor has detected an active service interruption.",
      badge: "Service interruption"
    };
  }
  if (state === "attention") {
    return {
      title: "Service checks are in progress",
      detail: "A fresh availability result will appear shortly.",
      badge: "Checking"
    };
  }
  if (state === "operational") {
    return {
      title: "All services are operational",
      detail: "No service interruptions have been detected.",
      badge: "Operational"
    };
  }
  return {
    title: "Status is being prepared",
    detail: "Some services are private or do not have an automated check.",
    badge: "Limited visibility"
  };
}

function statusMark(state: OverallState, large: boolean): string {
  const symbol = state === "operational" ? "✓" : state === "outage" ? "!" : "·";
  const label = state === "operational"
    ? "Operational"
    : state === "outage"
      ? "Service interruption"
      : state === "attention"
        ? "Checking"
        : "Limited visibility";
  return `<span class="status-mark status-mark--${state}${large ? " status-mark--large" : ""}" role="img" aria-label="${label}">${symbol}</span>`;
}

function emptyState(): string {
  return `<div class="status-empty"><h3>No services published yet</h3><p>The status catalog is being prepared.</p></div>`;
}
