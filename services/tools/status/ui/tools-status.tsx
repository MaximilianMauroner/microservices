import type {
  PublicCatalogEntry,
  PublicDowntimeRecord,
  PublicMonitorStatus,
  PublicSnapshotDocument,
  PrivateSnapshotDocument
} from "@tools-platform/domain";
import { Link } from "@tanstack/react-router";
import { AppShell } from "../../src/components/app-shell.js";
import { LocalDate, LocalTimeRange, LocalTimestamp } from "../../src/components/local-time.js";
import { Badge } from "../../src/components/ui/badge.js";
import { Button } from "../../src/components/ui/button.js";
import { Card } from "../../src/components/ui/card.js";
import { formatTimestamp, resolveBrowserLink } from "../../dashboard/ui/tools-directory.js";
import { projectPrivateCatalog } from "../../dashboard/ui/private-catalog-projection.js";

type OverallState = "operational" | "attention" | "outage" | "unknown";

export function ToolsStatus({ snapshot, publicOrigin }: { snapshot: PublicSnapshotDocument | PrivateSnapshotDocument; publicOrigin: string }) {
  if ("catalog" in snapshot) {
    return <ToolsStatusView snapshot={projectPrivateCatalog(snapshot, "all")} publicOrigin={publicOrigin} view="combined" />;
  }
  return <ToolsStatusView snapshot={snapshot} publicOrigin={publicOrigin} view="public" />;
}

export function PrivateToolsStatus({ snapshot, actor, publicOrigin }: { snapshot: PrivateSnapshotDocument; actor: string; publicOrigin: string }) {
  return <ToolsStatusView snapshot={projectPrivateCatalog(snapshot, "private")} publicOrigin={publicOrigin} view="private" actor={actor} />;
}

function ToolsStatusView({ snapshot, publicOrigin, view, actor }: { snapshot: PublicSnapshotDocument; publicOrigin: string; view: "public" | "combined" | "private"; actor?: string }) {
  const entries = [...snapshot.entries].sort(byOrderThenId);
  const overall = overallState(entries, snapshot.statuses);
  const unmeasuredCount = entries.filter((entry) => {
    const state = snapshot.statuses[entry.id]?.status;
    return state !== "up" && state !== "down" && state !== "checking";
  }).length;
  const summary = overallSummary(overall, unmeasuredCount);

  return (
    <>
      <AppShell product="Status" accent="cyan" showSignOut />
      <div className={`status-page status-page--${overall}`}>
        <main id="main" className="status-wrap status-main">
          <section className="status-hero" aria-labelledby="status-title">
            <p className="eyebrow">System status</p>
            <StatusMark state={overall} large />
            <h1 id="status-title">{summary.title}</h1>
            <p>{summary.detail}</p>
            {summary.coverage ? <p className="status-coverage">{summary.coverage}</p> : null}
            <p className="status-updated">
              Last updated <LocalTimestamp value={snapshot.generatedAt} fallback={formatTimestamp(snapshot.generatedAt)} />
            </p>
          </section>
          <Card id="services" className="status-card" aria-labelledby="services-title">
            <header className="status-card__header">
              <h2 id="services-title">Current status by service</h2>
              <Badge variant={overallBadgeVariant(overall)} className={`overall-badge overall-badge--${overall}`}>
                <StatusMark state={overall} />
                {summary.badge}
              </Badge>
            </header>
            {entries.length === 0 ? (
              <div className="status-empty"><h3>No services published yet</h3><p>The status catalog is being prepared.</p></div>
            ) : (
              <ul className="service-list" role="list">
                {entries.map((entry) => (
                  <ServiceRow
                    key={entry.id}
                    entry={entry}
                    status={snapshot.statuses[entry.id]}
                    generatedAt={snapshot.generatedAt}
                    publicOrigin={publicOrigin}
                  />
                ))}
              </ul>
            )}
          </Card>
          {view === "private" ? (
            <div className="private-status-identity"><Link to="/status" preload="intent">← All services</Link><span>Signed in as {actor}</span></div>
          ) : view === "public" ? (
            <section className="private-status-callout" aria-labelledby="private-status-title">
              <div className="private-status-callout__icon" aria-hidden="true"><span className="suite-lock" /></div>
              <div>
                <h2 id="private-status-title">Private service status</h2>
                <p>Sign in with Google to view availability for internal services.</p>
              </div>
              <Button variant="secondary" className="private-status-link" render={<Link to="/" preload="intent" />}>
                Open Tools <span aria-hidden="true">›</span>
              </Button>
            </section>
          ) : null}
        </main>
        <footer className="status-footer">
          <div className="status-wrap"><span className="footer-mark" aria-hidden="true">M</span><span>Managed by Mauroner</span><span aria-hidden="true">·</span><span>Five-minute checks</span></div>
        </footer>
      </div>
    </>
  );
}

function ServiceRow({ entry, status, generatedAt, publicOrigin }: {
  entry: PublicCatalogEntry;
  status: PublicMonitorStatus | undefined;
  generatedAt: string;
  publicOrigin: string;
}) {
  const state = serviceState(status);
  const uptime = uptimeSummary(status, generatedAt);
  const links = entry.links.flatMap((link) => {
    const destination = safeHttpUrl(link.url);
    return destination ? [{ ...link, destination }] : [];
  });
  return (
    <li className="service-row">
      <div className="service-heading">
        <div><StatusMark state={state} /><h3>{entry.name}</h3></div>
        <span className={`service-state service-state--${state}`}>{uptime.label}</span>
      </div>
      <p className="service-description">{entry.description}</p>
      <UptimeBar status={status} generatedAt={generatedAt} summary={uptime} />
      <p className="uptime-scroll-hint">Swipe horizontally to inspect daily checks.</p>
      <div className="uptime-legend" aria-hidden="true">
        <span><i className="uptime-key uptime-key--operational" />Operational</span>
        <span><i className="uptime-key uptime-key--attention" />Partial outage</span>
        <span><i className="uptime-key uptime-key--outage" />Outage</span>
        <span><i className="uptime-key uptime-key--unknown" />No data</span>
      </div>
      <div className="service-meta">
        <span>{uptime.firstObservedDay ? `Observed since ${uptime.firstObservedDay}` : "No checks recorded"}</span>
        <span>{uptime.totalChecks > 0 ? `${uptime.totalChecks} ${uptime.totalChecks === 1 ? "check" : "checks"} · ` : ""}<StatusDetails status={status} /></span>
        <span>Today</span>
      </div>
      <DowntimeHistory status={status} generatedAt={generatedAt} />
      {links.length > 0 ? (
        <div className="service-links" role="group" aria-label={`${entry.name} links`}>
          {links.map((link) => (
            <ServiceLink key={link.id} href={link.destination} label={link.label} restricted={link.access === "restricted"} publicOrigin={publicOrigin} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

function ServiceLink({ href, label, restricted, publicOrigin }: { href: string; label: string; restricted: boolean; publicOrigin: string }) {
  const resolvedHref = resolveBrowserLink(href, publicOrigin);
  const sameOrigin = resolvedHref !== href;
  return (
    <Button
      variant="secondary"
      className="service-link directory-action"
      render={sameOrigin ? <Link to={resolvedHref} preload="intent" /> : <a href={resolvedHref} target="_blank" rel="noreferrer" />}
    >
      <span>{label}</span>
      {restricted ? <span className="service-access">Access protected</span> : null}
      <span aria-hidden="true">{sameOrigin ? "›" : "↗"}</span>
    </Button>
  );
}

function UptimeBar({ status, generatedAt, summary }: { status: PublicMonitorStatus | undefined; generatedAt: string; summary: UptimeSummary }) {
  const knownDays = new Map((status?.uptimeDays ?? []).map((day) => [day.day, day]));
  const days = rollingDays(generatedAt);
  const label = summary.percentage === null
    ? `Observed uptime is not available. 0 recorded days and ${summary.noDataDays} no-data days.`
    : `${summary.label} across ${summary.totalChecks} checks; ${summary.recordedDays} recorded days and ${summary.noDataDays} no-data days.`;
  return (
    <div className="uptime-bar-scroll" role="region" aria-label="90-day uptime history" tabIndex={0}>
      <div className="uptime-bar" role="group" aria-label={label}>
        <span className="visually-hidden">{label}</span>
      {days.map((day) => {
        const uptime = knownDays.get(day);
        const dayRecords = status?.downtimeRecords === undefined
          ? null
          : downtimeRecordsForDay(day, status.downtimeRecords, generatedAt);
        const downtime = dayRecords === null
          ? null
          : dayRecords.reduce((sum, record) => sum + downtimeForDay(day, record, generatedAt), 0);
        const state = uptime === undefined ? "unknown" : uptime.successfulChecks === uptime.totalChecks ? "operational" : uptime.successfulChecks === 0 ? "outage" : "attention";
        const title = uptime === undefined ? `${day} · No check data` : `${day} · ${formatPercentage(uptime.successfulChecks, uptime.totalChecks)} uptime · ${downtime === null ? "Downtime unavailable" : `${formatDuration(downtime)} recorded downtime`} · ${uptime.totalChecks} checks`;
        const interruptionCount = dayRecords?.length ?? null;
        const interruptionLabel = interruptionCount === null
          ? "Interruption history unavailable"
          : interruptionCount === 0
            ? "No interruptions recorded"
            : `${interruptionCount} ${interruptionCount === 1 ? "interruption" : "interruptions"} recorded`;
        return uptime === undefined ? (
          <span key={day} className="uptime-day uptime-day--unknown" role="img" aria-label={title} title={title} />
        ) : (
          <span key={day} className={`uptime-day uptime-day--${state}`} role="img" tabIndex={0} aria-label={title} title={title}>
            <span className="uptime-popover" role="tooltip" aria-hidden="true">
              <span className="uptime-popover__header"><span>{formatUptimeDate(day)}</span><span className={`uptime-popover__state uptime-popover__state--${state}`}>{state === "operational" ? "Operational" : state === "outage" ? "Outage" : "Partial outage"}</span></span>
              <strong className="uptime-popover__percentage">{formatPercentage(uptime.successfulChecks, uptime.totalChecks)} uptime</strong>
              <span className="uptime-popover__metrics"><span><small>Recorded downtime</small><b>{downtime === null ? "Unavailable" : formatDuration(downtime)}</b></span><span><small>Checks</small><b>{uptime.totalChecks}</b></span></span>
              <span className="uptime-popover__footer">{interruptionLabel}</span>
            </span>
          </span>
        );
      })}
      </div>
    </div>
  );
}

function DowntimeHistory({ status, generatedAt }: { status: PublicMonitorStatus | undefined; generatedAt: string }) {
  const records = status?.downtimeRecords ?? [];
  if (records.length === 0) return null;
  const generatedTime = new Date(generatedAt).getTime();
  const total = records.reduce((sum, record) => sum + downtimeDuration(record, generatedTime), 0);
  return (
    <section className="downtime-history" aria-label="Downtime records">
      <div className="downtime-history__heading"><h4>Downtime records</h4><span>{records.length} {records.length === 1 ? "interruption" : "interruptions"} · {formatDuration(total)} total</span></div>
      <ol>{[...records].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((record) => {
        const startedAt = new Date(record.startedAt);
        const resolvedAt = record.resolvedAt ? new Date(record.resolvedAt) : null;
        return (
          <li key={`${record.startedAt}-${record.resolvedAt ?? "open"}`}>
            <LocalDate value={record.startedAt} fallback={formatShortDate(startedAt)} />
            <div><strong><LocalTimeRange start={record.startedAt} end={record.resolvedAt} fallback={resolvedAt ? `${formatClock(startedAt)}–${formatClock(resolvedAt)} UTC` : `${formatClock(startedAt)}–ongoing UTC`} /></strong><span>{resolvedAt ? "Recovered" : "Incident ongoing"}</span></div>
            <span className="downtime-duration">{formatDuration(downtimeDuration(record, generatedTime))}</span>
          </li>
        );
      })}</ol>
    </section>
  );
}

function StatusDetails({ status }: { status: PublicMonitorStatus | undefined }) {
  if (!status) return <>No automated check</>;
  if (!status.checkedAt) return <>{status.status === "unavailable" ? "Not checkable from Railway" : "Awaiting first check"}</>;
  const metrics = [status.latencyMs === null ? null : `${status.latencyMs} ms`, status.statusCode === null ? null : `HTTP ${status.statusCode}`].filter(Boolean);
  return <>Latest check <LocalTimestamp value={status.checkedAt} fallback={formatTimestamp(status.checkedAt)} />{metrics.length ? ` · ${metrics.join(" · ")}` : ""}</>;
}

function StatusMark({ state, large = false }: { state: OverallState; large?: boolean }) {
  const symbol = state === "operational" ? "✓" : state === "outage" ? "!" : "·";
  const label = state === "operational" ? "Operational" : state === "outage" ? "Service interruption" : state === "attention" ? "Checking" : "Limited visibility";
  return <span className={`status-mark status-mark--${state}${large ? " status-mark--large" : ""}`} role="img" aria-label={label}>{symbol}</span>;
}

function serviceState(status: PublicMonitorStatus | undefined): OverallState {
  if (!status) return "unknown";
  if (status.status === "down") return "outage";
  if (status.status === "checking") return "attention";
  if (status.status === "up") return "operational";
  return "unknown";
}

function overallState(entries: PublicCatalogEntry[], statuses: PublicSnapshotDocument["statuses"]): OverallState {
  const monitored = entries.map(({ id }) => statuses[id]).filter((status): status is PublicMonitorStatus => status !== undefined);
  if (monitored.some(({ status }) => status === "down")) return "outage";
  if (monitored.some(({ status }) => status === "checking")) return "attention";
  if (monitored.some(({ status }) => status === "up") && monitored.every(({ status }) => status === "up" || status === "paused" || status === "unavailable")) return "operational";
  return "unknown";
}

function overallSummary(state: OverallState, count: number) {
  const coverage = count === 0 ? "" : `${count} ${count === 1 ? "service" : "services"} not measured`;
  if (state === "outage") return { title: "Some services are unavailable", detail: "The monitor has detected an active service interruption.", badge: "Service interruption", coverage };
  if (state === "attention") return { title: "Service checks are in progress", detail: "A fresh availability result will appear shortly.", badge: "Checking", coverage };
  if (state === "operational") return { title: "All monitored services operational", detail: "No service interruptions have been detected.", badge: "Operational", coverage };
  return { title: "Monitoring visibility is limited", detail: "No service currently has a measured availability result.", badge: "Limited visibility", coverage };
}

function overallBadgeVariant(state: OverallState) {
  if (state === "operational") return "default" as const;
  if (state === "outage") return "destructive" as const;
  if (state === "attention") return "secondary" as const;
  return "outline" as const;
}

interface UptimeSummary { label: string; percentage: number | null; totalChecks: number; firstObservedDay: string | null; recordedDays: number; noDataDays: number }

function uptimeSummary(status: PublicMonitorStatus | undefined, generatedAt: string): UptimeSummary {
  const window = new Set(rollingDays(generatedAt));
  const days = (status?.uptimeDays ?? []).filter(({ day }) => window.has(day));
  const successful = days.reduce((sum, day) => sum + day.successfulChecks, 0);
  const total = days.reduce((sum, day) => sum + day.totalChecks, 0);
  const observed = days.filter(({ totalChecks }) => totalChecks > 0).map(({ day }) => day).sort();
  if (total === 0) return { label: status?.status === "unavailable" ? "Not measured" : status ? "Collecting uptime" : "Not monitored", percentage: null, totalChecks: 0, firstObservedDay: null, recordedDays: 0, noDataDays: 90 };
  return { label: `Observed uptime: ${formatPercentage(successful, total)}`, percentage: successful / total * 100, totalChecks: total, firstObservedDay: observed[0] ?? null, recordedDays: observed.length, noDataDays: 90 - observed.length };
}

function rollingDays(generatedAt: string) { const end = new Date(generatedAt); end.setUTCHours(0, 0, 0, 0); return Array.from({ length: 90 }, (_, index) => { const day = new Date(end); day.setUTCDate(day.getUTCDate() - (89 - index)); return day.toISOString().slice(0, 10); }); }
function formatPercentage(successful: number, total: number) { const value = successful / total * 100; return value === 100 ? "100%" : `${value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`; }
function formatUptimeDate(day: string) { return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00.000Z`)); }
function downtimeRecordsForDay(day: string, records: PublicDowntimeRecord[], generatedAt: string) { return records.filter((record) => downtimeForDay(day, record, generatedAt) > 0); }
function downtimeForDay(day: string, record: PublicDowntimeRecord, generatedAt: string) { const start = new Date(`${day}T00:00:00.000Z`).getTime(); return downtimeDurationInRange(record, new Date(generatedAt).getTime(), start, start + 86400000); }
function downtimeDuration(record: PublicDowntimeRecord, generatedTime: number) { return downtimeDurationInRange(record, generatedTime, new Date(record.startedAt).getTime(), generatedTime); }
function downtimeDurationInRange(record: PublicDowntimeRecord, generatedTime: number, rangeStart: number, rangeEnd: number) { const start = new Date(record.startedAt).getTime(); const end = record.resolvedAt ? new Date(record.resolvedAt).getTime() : generatedTime; return Math.max(0, Math.min(end, rangeEnd, generatedTime) - Math.max(start, rangeStart)); }
function formatDuration(ms: number) { const seconds = Math.max(0, Math.round(ms / 1000)); if (seconds < 60) return `${seconds}s`; const minutes = Math.floor(seconds / 60); if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes} min`; return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`; }
function formatClock(value: Date) { return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(value); }
function formatShortDate(value: Date) { return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(value); }
function byOrderThenId<T extends { id: string; order: number }>(a: T, b: T) { return a.order - b.order || a.id.localeCompare(b.id); }
function safeHttpUrl(value: string) { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null; } catch { return null; } }
