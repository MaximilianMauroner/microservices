import type {
  PublicCatalogEntry,
  PublicDowntimeRecord,
  PublicMonitorStatus,
  PublicSnapshotDocument,
  PrivateSnapshotDocument
} from "@tools-platform/domain";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, ChevronRight, LockKeyhole } from "lucide-react";
import { PageHeader } from "../../src/components/page-header.js";
import { AppShell } from "../../src/components/app-shell.js";
import { favicons } from "../../src/favicons.js";
import { LocalDate, LocalTimeRange, LocalTimestamp } from "../../src/components/local-time.js";
import { Button } from "../../src/components/ui/button.js";
import { formatTimestamp, resolveBrowserLink } from "../../dashboard/ui/tools-directory-helpers.js";
import { projectPrivateCatalog } from "../../dashboard/ui/private-catalog-projection.js";
import { countLabel } from "../../src/lib/count-label.js";

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
  const up = entries.filter(({ id }) => snapshot.statuses[id]?.status === "up").length;
  const down = entries.filter(({ id }) => snapshot.statuses[id]?.status === "down");
  const checked = entries.flatMap(({ id }) => snapshot.statuses[id]?.checkedAt ? [snapshot.statuses[id]!.checkedAt!] : []).sort().at(-1);
  const measured = entries.flatMap(({ id }) => snapshot.statuses[id]?.uptimeDays ?? []);
  const successfulChecks = measured.reduce((sum, day) => sum + day.successfulChecks, 0);
  const totalChecks = measured.reduce((sum, day) => sum + day.totalChecks, 0);
  const latencies = entries.flatMap(({ id }) => snapshot.statuses[id]?.latencyMs === null || snapshot.statuses[id]?.latencyMs === undefined ? [] : [snapshot.statuses[id]!.latencyMs!]).sort((a, b) => a - b);
  const incidents = entries.flatMap((entry) => (snapshot.statuses[entry.id]?.downtimeRecords ?? []).map((record) => ({ entry, record }))).sort((a, b) => b.record.startedAt.localeCompare(a.record.startedAt));
  const recentIncidents = incidents.filter(({ record }) => !record.resolvedAt || new Date(record.startedAt).getTime() >= new Date(snapshot.generatedAt).getTime() - 30 * 86_400_000);
  const summary = overallSummary(overall, entries.length - up - down.length);

  return <>
    <AppShell product="Status" accent="cyan" icon={favicons.status} />
    <main id="main" className="tools-page status-compact">
      <PageHeader title="Status" facts={<>Checked every 30 minutes · {checked ? <>last check <LocalTimestamp value={checked} fallback={formatTimestamp(checked)} /></> : "no checks recorded"}</>} />
      <div className="grid gap-3">
        <section className="overflow-hidden rounded-xl border bg-card" aria-label="Status summary">
          <div className="flex items-start gap-3 p-4"><StatusMark state={overall} /><div><h2 className="text-base font-semibold">{down.length ? `${down.length} ${down.length === 1 ? "service is" : "services are"} down` : summary.title}</h2><p className="mt-1 text-sm text-muted-foreground">{down.length ? `${down.map((entry) => entry.name).join(", ")} ${down.length === 1 ? "has" : "have"} failed the latest check. ${up} of ${entries.length} services are operational.` : summary.detail}</p>{summary.coverage ? <p className="mt-1 text-xs text-muted-foreground">{summary.coverage}</p> : null}</div></div>
          <dl className="status-stats grid grid-cols-2 border-t sm:grid-cols-4"><div className="p-3"><dt className="text-xs text-muted-foreground">Operational</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{up} of {entries.length}</dd></div><div className="p-3"><dt className="text-xs text-muted-foreground">Observed uptime, 90 days</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{totalChecks ? formatPercentage(successfulChecks, totalChecks) : "No data"}</dd></div><div className="p-3"><dt className="text-xs text-muted-foreground">Incidents, 30 days</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{recentIncidents.length}</dd></div><div className="p-3"><dt className="text-xs text-muted-foreground">Median latest latency</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{latencies.length ? `${latencies[Math.floor((latencies.length - 1) / 2)]} ms` : "No data"}</dd></div></dl>
        </section>
        <section className="overflow-hidden rounded-xl border bg-card" aria-labelledby="services-title"><div className="border-b px-4 py-3"><h2 id="services-title" className="text-sm font-semibold">Services</h2><p className="text-xs text-muted-foreground">Last 90 days · today at right · select a service for details</p></div>
          {entries.length ? <ul className="divide-y" role="list">{entries.map((entry) => <ServiceRow key={entry.id} entry={entry} status={snapshot.statuses[entry.id]} generatedAt={snapshot.generatedAt} publicOrigin={publicOrigin} />)}</ul> : <div className="status-empty"><h3>No services published yet</h3><p>The status catalog is being prepared.</p></div>}
          <div className="flex flex-wrap gap-4 border-t px-4 py-3 text-xs text-muted-foreground"><span><i className="uptime-key uptime-key--operational" />Up</span><span><i className="uptime-key uptime-key--attention" />Some checks failed</span><span><i className="uptime-key uptime-key--outage" />Down</span><span><i className="uptime-key uptime-key--unknown" />No data</span></div>
        </section>
        <section className="overflow-hidden rounded-xl border bg-card" aria-labelledby="incidents-title"><div className="flex items-center justify-between border-b px-4 py-3"><h2 id="incidents-title" className="text-sm font-semibold">Incidents</h2><span className="text-xs text-muted-foreground">Last 30 days</span></div>
          {recentIncidents.length ? <ol className="divide-y">{recentIncidents.map(({ entry, record }) => <li key={`${entry.id}:${record.startedAt}`} className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-sm"><LocalDate value={record.startedAt} fallback={formatShortDate(new Date(record.startedAt))} /><span className="min-w-0"><strong className="block truncate font-medium">{entry.name}</strong><span className="block text-xs text-muted-foreground"><LocalTimeRange start={record.startedAt} end={record.resolvedAt} fallback={record.resolvedAt ? `${formatClock(new Date(record.startedAt))}–${formatClock(new Date(record.resolvedAt))} UTC` : `${formatClock(new Date(record.startedAt))}–ongoing UTC`} /></span></span><span className={`text-xs tabular-nums ${record.resolvedAt ? "text-muted-foreground" : "text-negative"}`}>{formatDuration(downtimeDuration(record, new Date(snapshot.generatedAt).getTime()))}</span></li>)}</ol> : <p className="px-4 py-5 text-sm text-muted-foreground">No recorded incidents in the last 30 days.</p>}
        </section>
      </div>
      {view === "private" ? <div className="private-status-identity"><Link to="/status" preload="intent">← All services</Link><span>Signed in as {actor}</span></div> : view === "public" ? <section className="private-status-callout" aria-labelledby="private-status-title"><div className="private-status-callout__icon" aria-hidden="true"><LockKeyhole className="size-4" /></div><div><h2 id="private-status-title">Private service status</h2><p>Sign in with Google to view availability for internal services.</p></div><Button variant="outline" className="private-status-link" render={<Link to="/" preload="intent" />}>Open Tools <ChevronRight aria-hidden="true" /></Button></section> : null}
    </main>
  </>;
}

function ServiceRow({ entry, status, generatedAt, publicOrigin }: { entry: PublicCatalogEntry; status: PublicMonitorStatus | undefined; generatedAt: string; publicOrigin: string }) {
  const state = serviceState(status);
  const uptime = uptimeSummary(status, generatedAt);
  const links = entry.links.flatMap((link) => {
    const destination = safeHttpUrl(link.url);
    return destination ? [{ ...link, destination }] : [];
  });
  return <li><details className="status-service"><summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 marker:hidden lg:grid-cols-[minmax(9rem,1.2fr)_minmax(8rem,.8fr)_minmax(12rem,2fr)_5rem_5rem]"><span className="flex min-w-0 items-center gap-2"><StatusMark state={state} /><span className="min-w-0"><strong className="block truncate text-sm">{entry.name}</strong><span className="block truncate text-xs text-muted-foreground">{entry.description}</span></span></span><span className={`text-right text-xs lg:text-left ${state === "outage" ? "text-negative" : "text-muted-foreground"}`}>{state === "outage" ? "Down" : state === "operational" ? "Operational" : status?.status ?? "No data"}</span><span className="col-span-2 lg:col-span-1"><UptimeBar status={status} generatedAt={generatedAt} summary={uptime} /></span><span className="hidden text-right text-xs tabular-nums lg:block">{uptime.percentage === null ? "—" : `${uptime.percentage.toFixed(2)}%`}</span><span className="hidden text-right text-xs tabular-nums text-muted-foreground lg:block">{status?.latencyMs == null ? "—" : `${status.latencyMs} ms`}</span></summary><div className="grid gap-3 border-t bg-muted/20 px-4 py-3 text-xs sm:grid-cols-2"><div><p><StatusDetails status={status} /></p><p className="mt-1 text-muted-foreground">{uptime.firstObservedDay ? `Observed since ${uptime.firstObservedDay} across ${uptime.totalChecks} checks` : "No checks recorded"}</p><DowntimeHistory status={status} generatedAt={generatedAt} /></div><div><p className="text-muted-foreground">Links</p><div className="service-links">{links.length ? links.map((link) => <ServiceLink key={link.id} href={link.destination} label={link.label} restricted={link.access === "restricted"} publicOrigin={publicOrigin} />) : <span>No links published</span>}</div></div></div></details></li>;
}

function ServiceLink({ href, label, restricted, publicOrigin }: { href: string; label: string; restricted: boolean; publicOrigin: string }) {
  const resolvedHref = resolveBrowserLink(href, publicOrigin);
  const sameOrigin = resolvedHref !== href;
  return (
    <Button
      variant="outline"
      className="service-link text-foreground"
      render={sameOrigin ? <Link to={resolvedHref} preload="intent" /> : <a href={resolvedHref} target="_blank" rel="noreferrer" />}
    >
      <span>{label}</span>
      {restricted ? <span className="text-xs font-normal text-muted-foreground">· Access protected</span> : null}
      {sameOrigin ? <ChevronRight aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}
    </Button>
  );
}

function UptimeBar({ status, generatedAt, summary }: { status: PublicMonitorStatus | undefined; generatedAt: string; summary: UptimeSummary }) {
  const knownDays = new Map((status?.uptimeDays ?? []).map((day) => [day.day, day]));
  const days = rollingDays(generatedAt);
  const label = summary.percentage === null
    ? `Observed uptime is not available. 0 recorded days and ${countLabel(summary.noDataDays, "no-data day")}.`
    : `${summary.label} across ${countLabel(summary.totalChecks, "check")}; ${countLabel(summary.recordedDays, "recorded day")} and ${countLabel(summary.noDataDays, "no-data day")}.`;
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
  const symbol = state === "operational" ? "✓" : state === "outage" ? "!" : state === "attention" ? "?" : "·";
  const label = state === "operational" ? "Operational" : state === "outage" ? "Service interruption" : state === "attention" ? "Inconclusive" : "Limited visibility";
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
  if (state === "attention") return { title: "Some service results are inconclusive", detail: "Review the latest recorded check for each service. The next scheduled check may update this status.", badge: "Review checks", coverage };
  if (state === "operational") return { title: "All monitored services operational", detail: "No service interruptions have been detected.", badge: "Operational", coverage };
  return { title: "Monitoring visibility is limited", detail: "No service currently has a measured availability result.", badge: "Limited visibility", coverage };
}

function overallBadgeVariant(state: OverallState) {
  if (state === "operational") return "positive" as const;
  if (state === "outage") return "destructive" as const;
  if (state === "attention") return "warning" as const;
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
function formatUptimeDate(day: string) { return new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00.000Z`)); }
function downtimeRecordsForDay(day: string, records: PublicDowntimeRecord[], generatedAt: string) { return records.filter((record) => downtimeForDay(day, record, generatedAt) > 0); }
function downtimeForDay(day: string, record: PublicDowntimeRecord, generatedAt: string) { const start = new Date(`${day}T00:00:00.000Z`).getTime(); return downtimeDurationInRange(record, new Date(generatedAt).getTime(), start, start + 86400000); }
function downtimeDuration(record: PublicDowntimeRecord, generatedTime: number) { return downtimeDurationInRange(record, generatedTime, new Date(record.startedAt).getTime(), generatedTime); }
function downtimeDurationInRange(record: PublicDowntimeRecord, generatedTime: number, rangeStart: number, rangeEnd: number) { const start = new Date(record.startedAt).getTime(); const end = record.resolvedAt ? new Date(record.resolvedAt).getTime() : generatedTime; return Math.max(0, Math.min(end, rangeEnd, generatedTime) - Math.max(start, rangeStart)); }
function formatDuration(ms: number) { const seconds = Math.max(0, Math.round(ms / 1000)); if (seconds < 60) return `${seconds}s`; const minutes = Math.floor(seconds / 60); if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes} min`; return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`; }
function formatClock(value: Date) { return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(value); }
function formatShortDate(value: Date) { return new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric", timeZone: "UTC" }).format(value); }
function byOrderThenId<T extends { id: string; order: number }>(a: T, b: T) { return a.order - b.order || a.id.localeCompare(b.id); }
function safeHttpUrl(value: string) { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null; } catch { return null; } }
