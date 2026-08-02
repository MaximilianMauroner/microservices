import type {
  MonitorStatus,
  PrivateSnapshotDocument,
  PublicCatalogEntry,
  PublicDowntimeRecord,
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

const TOOL_ICON_PATHS: Readonly<Record<string, string>> = {
  "artifact-publisher": "/assets/icons/artifact-publisher.png",
  "field-guide-console": "/assets/icons/field-guide-console.png",
  "tools-directory": "/assets/icons/tools-status-directory.png",
  "network-console": "/assets/icons/network-console.png"
};

const STATUS_LABELS: Record<MonitorStatus, string> = {
  checking: "Checking",
  up: "Operational",
  down: "Unavailable",
  paused: "Monitoring paused",
  unavailable: "Not checkable from Railway"
};

export function renderPublicPage(
  snapshot: PublicSnapshotDocument,
  publicOrigin = "https://tools.mauroner.net"
): string {
  const groups = [...snapshot.groups].sort(byOrderThenId);
  const entries = [...snapshot.entries].sort(byOrderThenId);
  const body = `<main id="main" class="tools-home">
      <section class="tools-intro wrap" aria-labelledby="tools-title">
        <p class="eyebrow">Useful, focused services</p>
        <h1 id="tools-title">Tools for publishing, review, and operations.</h1>
        <p class="lede">A curated directory of Mauroner services, with clear access requirements and live availability.</p>
        <a class="browse-tools" href="#catalog">Browse tools <span aria-hidden="true">↓</span></a>
        <p class="freshness">Catalog updated <time datetime="${escapeHtml(snapshot.generatedAt)}" data-local-timestamp>${formatTimestamp(snapshot.generatedAt)}</time></p>
      </section>
      <section id="catalog" class="catalog wrap" aria-label="Tool directory">
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
            <ul class="tool-grid" role="list">${groupEntries.map((entry) => renderToolCard(entry, snapshot.statuses[entry.id], publicOrigin)).join("")}</ul>
          </section>`;
        }).join("")}
      </section>
    </main>
    <footer class="site-footer"><div class="wrap">Mauroner Tools · Availability updates every five minutes</div></footer>`;
  return pageShell({
    title: "Mauroner Tools",
    description: "Publishing, review, status, and operations tools.",
    body,
    active: "tools",
    canonicalUrl: new URL("/", publicOrigin).toString()
  });
}

export function renderStatusPage(
  snapshot: PublicSnapshotDocument,
  publicOrigin = "https://tools.mauroner.net"
): string {
  return renderStatusView(snapshot, publicOrigin, {
    serviceTitle: "Current status by service",
    privateView: false
  });
}

export function renderPrivateStatusPage(
  snapshot: PrivateSnapshotDocument,
  actor: string,
  publicOrigin = "https://tools.mauroner.net"
): string {
  return renderStatusView(privateStatusSnapshot(snapshot), publicOrigin, {
    serviceTitle: "Private services",
    privateView: true,
    actor
  });
}

function renderStatusView(
  snapshot: PublicSnapshotDocument,
  publicOrigin: string,
  options: {
    serviceTitle: string;
    privateView: boolean;
    actor?: string;
  }
): string {
  const entries = [...snapshot.entries].sort(byOrderThenId);
  const overall = overallState(entries, snapshot.statuses);
  const unmeasuredCount = entries.filter((entry) => snapshot.statuses[entry.id]?.status !== "up" && snapshot.statuses[entry.id]?.status !== "down" && snapshot.statuses[entry.id]?.status !== "checking").length;
  const summary = overallSummary(overall, unmeasuredCount);
  const body = `<div class="status-page status-page--${overall}">
    <main id="main" class="status-wrap status-main">
      <section class="status-hero" aria-labelledby="status-title">
        ${statusMark(overall, true)}
        <h1 id="status-title">${summary.title}</h1>
        <p>${summary.detail}</p>${summary.coverage ? `<p class="status-coverage">${summary.coverage}</p>` : ""}
        <p class="status-updated">Last updated <time datetime="${escapeHtml(snapshot.generatedAt)}" data-local-timestamp>${formatTimestamp(snapshot.generatedAt)}</time></p>
      </section>
      <section id="services" class="status-card" aria-labelledby="services-title">
        <header class="status-card__header">
          <h2 id="services-title">${escapeHtml(options.serviceTitle)}</h2>
          <span class="overall-badge overall-badge--${overall}">${statusMark(overall, false)}${summary.badge}</span>
        </header>
        ${entries.length === 0 ? emptyState() : `<ul class="service-list" role="list">${entries.map((entry) => renderEntry(entry, snapshot.statuses[entry.id], snapshot.generatedAt, publicOrigin)).join("")}</ul>`}
      </section>
      ${options.privateView ? privateStatusIdentity(options.actor) : privateStatusCallout()}
    </main>
    <footer class="status-footer">
      <div class="status-wrap"><span class="footer-mark" aria-hidden="true">M</span><span>Managed by Mauroner</span><span aria-hidden="true">·</span><span>Five-minute checks</span></div>
    </footer>
  </div>`;

  return pageShell({
    title: `${options.privateView ? "Private status" : "Status"} — Mauroner Tools`,
    description: options.privateView
      ? "Current availability of private Mauroner tools and services."
      : "Current availability of Mauroner tools and services.",
    body,
    active: "status",
    ...(options.privateView
      ? { privatePage: true }
      : { canonicalUrl: new URL("/status", publicOrigin).toString() })
  });
}

function privateStatusCallout(): string {
  return `<section class="private-status-callout" aria-labelledby="private-status-title">
    <div class="private-status-callout__icon" aria-hidden="true"><span class="suite-lock"></span></div>
    <div>
      <h2 id="private-status-title">Private service status</h2>
      <p>Sign in with Cloudflare Access to view availability for internal services.</p>
    </div>
    <a href="/manage/status">View private status <span aria-hidden="true">›</span></a>
  </section>`;
}

function privateStatusIdentity(actor: string | undefined): string {
  return `<div class="private-status-identity">
    <a href="/status">← Public status</a>
    ${actor ? `<span>Signed in as ${escapeHtml(actor)}</span>` : ""}
  </div>`;
}

function privateStatusSnapshot(
  snapshot: PrivateSnapshotDocument
): PublicSnapshotDocument {
  const groupVisibility = new Map(
    snapshot.catalog.groups.map((group) => [group.id, group.visibility])
  );
  const entries = snapshot.catalog.entries
    .filter(
      (entry) =>
        entry.lifecycle === "active" &&
        !(
          entry.visibility === "public" &&
          groupVisibility.get(entry.groupId) === "public"
        )
    )
    .map((entry) => ({
      id: entry.id,
      groupId: entry.groupId,
      name: entry.name,
      description: entry.description,
      order: entry.order,
      links: entry.links.map(({ id, label, url, access }) => ({
        id,
        label,
        url,
        access: access === "private" ? "restricted" as const : access
      }))
    }));
  const entryIds = new Set(entries.map(({ id }) => id));
  const statuses: Record<string, PublicMonitorStatus> = {};

  for (const entry of snapshot.catalog.entries) {
    if (!entryIds.has(entry.id) || !entry.monitor?.enabled) continue;
    const monitor = snapshot.state.monitors[entry.id];
    statuses[entry.id] = {
      monitorId: entry.id,
      status: monitor?.status ?? (entry.monitor.paused ? "paused" : "checking"),
      checkedAt: monitor?.latestObservation?.checkedAt ?? null,
      latencyMs: monitor?.latestObservation?.latencyMs ?? null,
      statusCode: monitor?.latestObservation?.statusCode ?? null,
      uptimeDays: monitor?.uptimeDays ?? [],
      downtimeRecords: snapshot.state.incidents
        .filter(({ monitorId }) => monitorId === entry.id)
        .map(({ startedAt, resolvedAt }) => ({ startedAt, resolvedAt }))
    };
  }

  return {
    schemaVersion: snapshot.schemaVersion,
    generatedAt: snapshot.generatedAt,
    catalogRevision: snapshot.catalogRevision,
    groups: snapshot.catalog.groups
      .filter((group) => entries.some((entry) => entry.groupId === group.id))
      .map(({ id, name, description, order }) => ({
        id,
        name,
        ...(description === undefined ? {} : { description }),
        order
      })),
    entries,
    statuses
  };
}

function renderToolCard(
  entry: PublicCatalogEntry,
  status: PublicMonitorStatus | undefined,
  publicOrigin: string
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
      return renderDirectoryLink(url, link.label, "tool-link", publicOrigin);
    })
    .filter(Boolean)
    .join("");
  const iconPath = TOOL_ICON_PATHS[entry.id];
  return `<li class="tool-card">
      <div class="tool-card__top">
        <div class="tool-card__identity">
          ${iconPath ? `<img class="tool-card__icon" src="${iconPath}" alt="" width="48" height="48">` : ""}
          <div>
            <p class="access-label access-label--${accessClass}">${accessLabels.includes("Cloudflare Access") ? '<span class="suite-lock" aria-hidden="true"></span>' : ""}${escapeHtml(accessLabels.join(" · "))}</p>
            <h3>${escapeHtml(entry.name)}</h3>
          </div>
        </div>
        ${statusBadge(status)}
      </div>
      <p>${escapeHtml(entry.description)}</p>
      <p class="status-detail">${escapeHtml(directoryStatusDetails(status))}</p>
      ${links ? `<div class="tool-links" role="group" aria-label="${escapeHtml(entry.name)} links">${links}</div>` : '<p class="no-link">No browser entry point is published.</p>'}
    </li>`;
}

function directoryEmptyState(): string {
  return '<div class="empty-state"><h2>No tools published yet</h2><p>The public catalog is ready for its first entry.</p></div>';
}

function renderEntry(
  entry: PublicCatalogEntry,
  status: PublicMonitorStatus | undefined,
  generatedAt: string,
  publicOrigin: string
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
      return renderDirectoryLink(url, link.label, "service-link", publicOrigin, access);
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
    <div class="uptime-legend" aria-hidden="true"><span><i class="uptime-key uptime-key--operational"></i>Operational</span><span><i class="uptime-key uptime-key--attention"></i>Partial outage</span><span><i class="uptime-key uptime-key--outage"></i>Outage</span><span><i class="uptime-key uptime-key--unknown"></i>No data</span></div>
    <div class="service-meta">
      <span>${uptime.firstObservedDay ? `Observed since ${escapeHtml(uptime.firstObservedDay)}` : "No checks recorded"}</span>
      <span>${uptime.totalChecks > 0 ? `${uptime.totalChecks} ${uptime.totalChecks === 1 ? "check" : "checks"} · ` : ""}${statusDetails(status)}</span>
      <span>Today</span>
    </div>
    ${downtimeHistory(status, generatedAt)}
    ${links ? `<div class="service-links" role="group" aria-label="${escapeHtml(entry.name)} links">${links}</div>` : ""}
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
    const dayDowntimeRecords = status?.downtimeRecords === undefined
      ? null
      : downtimeRecordsForDay(day, status.downtimeRecords, generatedAt);
    const downtime = dayDowntimeRecords === null
      ? null
      : dayDowntimeRecords.reduce(
          (total, record) => total + downtimeForDay(day, [record], generatedAt),
          0
        );
    const state = uptime === undefined
      ? "unknown"
      : uptime.successfulChecks === uptime.totalChecks
        ? "operational"
        : uptime.successfulChecks === 0
          ? "outage"
          : "attention";
    const title = uptime === undefined
      ? `${day} · No check data`
      : `${day} · ${formatPercentage(uptime.successfulChecks, uptime.totalChecks)} uptime · ${downtime === null ? "Downtime unavailable" : `${formatDuration(downtime)} recorded downtime`} · ${uptime.totalChecks} ${uptime.totalChecks === 1 ? "check" : "checks"}`;
    if (uptime === undefined) {
      return `<span class="uptime-day uptime-day--unknown" role="img" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}"></span>`;
    }
    const percentage = formatPercentage(
      uptime.successfulChecks,
      uptime.totalChecks
    );
    const stateLabel = state === "operational"
      ? "Operational"
      : state === "outage"
        ? "Outage"
        : "Partial outage";
    const interruptionCount = dayDowntimeRecords?.length ?? null;
    const interruptionLabel = interruptionCount === null
      ? "Interruption history unavailable"
      : interruptionCount === 0
        ? "No interruptions recorded"
        : `${interruptionCount} ${interruptionCount === 1 ? "interruption" : "interruptions"} recorded`;
    return `<span class="uptime-day uptime-day--${state}" role="img" tabindex="0" aria-label="${escapeHtml(title)}">
      <span class="uptime-popover" role="tooltip" aria-hidden="true">
        <span class="uptime-popover__header">
          <span>${escapeHtml(formatUptimeDate(day))}</span>
          <span class="uptime-popover__state uptime-popover__state--${state}">${stateLabel}</span>
        </span>
        <strong class="uptime-popover__percentage">${escapeHtml(percentage)} uptime</strong>
        <span class="uptime-popover__metrics">
          <span><small>Recorded downtime</small><b>${downtime === null ? "Unavailable" : escapeHtml(formatDuration(downtime))}</b></span>
          <span><small>Checks</small><b>${uptime.totalChecks}</b></span>
        </span>
        <span class="uptime-popover__footer">${escapeHtml(interruptionLabel)}</span>
      </span>
    </span>`;
  }).join("");
  const label = summary.percentage === null
    ? `Observed uptime is not available. 0 recorded days and ${summary.noDataDays} no-data days. Latest monitor state: ${status ? STATUS_LABELS[status.status] : "not monitored"}.`
    : `${summary.label} across ${summary.totalChecks} ${summary.totalChecks === 1 ? "check" : "checks"}; ${summary.recordedDays} ${summary.recordedDays === 1 ? "recorded day" : "recorded days"} and ${summary.noDataDays} ${summary.noDataDays === 1 ? "no-data day" : "no-data days"}; earliest recorded day ${summary.firstObservedDay}.`;
  return `<div class="uptime-bar" role="group" aria-label="${escapeHtml(label)}"><span class="visually-hidden">${escapeHtml(label)}</span>${bars}</div>`;
}

function downtimeHistory(
  status: PublicMonitorStatus | undefined,
  generatedAt: string
): string {
  const records = status?.downtimeRecords ?? [];
  if (records.length === 0) return "";
  const generatedTime = new Date(generatedAt).getTime();
  const totalDowntime = records.reduce(
    (total, record) => total + downtimeDuration(
      record,
      generatedTime,
      new Date(record.startedAt).getTime(),
      generatedTime
    ),
    0
  );
  const rows = [...records]
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .map((record) => {
      const startedAt = new Date(record.startedAt);
      const resolvedAt = record.resolvedAt === null
        ? null
        : new Date(record.resolvedAt);
      const duration = downtimeDuration(
        record,
        generatedTime,
        startedAt.getTime(),
        generatedTime
      );
      const window = resolvedAt === null
        ? `${formatClock(startedAt)}–ongoing UTC`
        : startedAt.toISOString().slice(0, 10) === resolvedAt.toISOString().slice(0, 10)
          ? `${formatClock(startedAt)}–${formatClock(resolvedAt)} UTC`
          : `${formatShortDate(startedAt)} ${formatClock(startedAt)}–${formatShortDate(resolvedAt)} ${formatClock(resolvedAt)} UTC`;
      return `<li>
              <time datetime="${escapeHtml(record.startedAt)}" data-local-date>${escapeHtml(formatShortDate(startedAt))}</time>
              <div><strong data-local-time-range data-start="${escapeHtml(record.startedAt)}"${record.resolvedAt === null ? "" : ` data-end="${escapeHtml(record.resolvedAt)}"`}>${escapeHtml(window)}</strong><span>${resolvedAt === null ? "Incident ongoing" : "Recovered"}</span></div>
              <span class="downtime-duration">${escapeHtml(formatDuration(duration))}</span>
            </li>`;
    })
    .join("");
  return `<section class="downtime-history" aria-label="Downtime records">
          <div class="downtime-history__heading">
            <h4>Downtime records</h4>
            <span>${records.length} ${records.length === 1 ? "interruption" : "interruptions"} · ${escapeHtml(formatDuration(totalDowntime))} total</span>
          </div>
          <ol>${rows}</ol>
        </section>`;
}

function downtimeForDay(
  day: string,
  records: PublicDowntimeRecord[],
  generatedAt: string
): number {
  const start = new Date(`${day}T00:00:00.000Z`).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  const generatedTime = new Date(generatedAt).getTime();
  return records.reduce(
    (total, record) =>
      total + downtimeDuration(record, generatedTime, start, end),
    0
  );
}

function downtimeRecordsForDay(
  day: string,
  records: PublicDowntimeRecord[],
  generatedAt: string
): PublicDowntimeRecord[] {
  const start = new Date(`${day}T00:00:00.000Z`).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  const generatedTime = new Date(generatedAt).getTime();
  return records.filter(
    (record) => downtimeDuration(record, generatedTime, start, end) > 0
  );
}

function downtimeDuration(
  record: PublicDowntimeRecord,
  generatedTime: number,
  rangeStart: number,
  rangeEnd: number
): number {
  const startedAt = new Date(record.startedAt).getTime();
  const resolvedAt = record.resolvedAt === null
    ? generatedTime
    : new Date(record.resolvedAt).getTime();
  return Math.max(
    0,
    Math.min(resolvedAt, rangeEnd, generatedTime) -
      Math.max(startedAt, rangeStart)
  );
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60;
    return seconds === 0 ? `${totalMinutes} min` : `${totalMinutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function formatClock(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC"
  }).format(value);
}

function formatShortDate(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(value);
}

function formatUptimeDate(day: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${day}T00:00:00.000Z`));
}

interface UptimeSummary {
  label: string;
  percentage: number | null;
  totalChecks: number;
  firstObservedDay: string | null;
  recordedDays: number;
  noDataDays: number;
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
      totalChecks: 0,
      firstObservedDay: null,
      recordedDays: 0,
      noDataDays: 90
    };
  }
  const observedDays = (status?.uptimeDays ?? [])
    .filter(({ day, totalChecks }) => rollingWindow.has(day) && totalChecks > 0)
    .map(({ day }) => day)
    .sort();
  return {
    label: `Observed uptime: ${formatPercentage(totals.successfulChecks, totals.totalChecks)}`,
    percentage: (totals.successfulChecks / totals.totalChecks) * 100,
    totalChecks: totals.totalChecks,
    firstObservedDay: observedDays[0] ?? null,
    recordedDays: observedDays.length,
    noDataDays: 90 - observedDays.length
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
  return `Latest check <time datetime="${escapeHtml(status.checkedAt)}" data-local-timestamp>${formatTimestamp(status.checkedAt)}</time>${metrics.length > 0 ? ` · ${metrics.join(" · ")}` : ""}`;
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
    monitored.some(({ status }) => status === "up") &&
    monitored.every(({ status }) =>
      status === "up" || status === "paused" || status === "unavailable"
    )
  ) {
    return "operational";
  }
  return "unknown";
}

function overallSummary(state: OverallState, unmeasuredCount: number): {
  title: string;
  detail: string;
  badge: string;
  coverage: string;
} {
  if (state === "outage") {
    return {
      title: "Some services are unavailable",
      detail: "The monitor has detected an active service interruption.",
      badge: "Service interruption",
      coverage: unmeasuredLabel(unmeasuredCount)
    };
  }
  if (state === "attention") {
    return {
      title: "Service checks are in progress",
      detail: "A fresh availability result will appear shortly.",
      badge: "Checking",
      coverage: unmeasuredLabel(unmeasuredCount)
    };
  }
  if (state === "operational") {
    return {
      title: "All monitored services operational",
      detail: "No service interruptions have been detected.",
      badge: "Operational",
      coverage: unmeasuredLabel(unmeasuredCount)
    };
  }
  return {
    title: "Monitoring visibility is limited",
    detail: "No service currently has a measured availability result.",
    badge: "Limited visibility",
    coverage: unmeasuredLabel(unmeasuredCount)
  };
}

function unmeasuredLabel(count: number): string {
  return count === 0 ? "" : `${count} ${count === 1 ? "service" : "services"} not measured`;
}

function renderDirectoryLink(
  url: string,
  label: string,
  className: string,
  publicOrigin: string,
  extra = ""
): string {
  const destination = new URL(url);
  const sameOrigin = destination.origin === new URL(publicOrigin).origin;
  const external = sameOrigin
    ? '<span aria-hidden="true">›</span>'
    : '<span aria-hidden="true">↗</span><span class="visually-hidden"> (opens in a new tab)</span>';
  return `<a class="${className}" href="${escapeHtml(url)}"${sameOrigin ? "" : ' target="_blank" rel="noreferrer"'}><span>${escapeHtml(label)}</span>${extra}${external}</a>`;
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
