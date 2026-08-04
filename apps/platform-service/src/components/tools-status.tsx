import type {
  PublicCatalogEntry,
  PublicDowntimeRecord,
  PublicMonitorStatus,
  PublicSnapshotDocument,
  PrivateSnapshotDocument
} from "@tools-platform/domain";
import { Bar, BarChart, Cell, XAxis } from "recharts";
import { AppShell } from "./app-shell.js";
import { formatUtcClock, formatUtcDate, formatUtcShortDate } from "./date-format.js";
import { LocalDate, LocalTimeRange, LocalTimestamp } from "./local-time.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { Card } from "./ui/card.js";
import { ChartContainer, ChartTooltip, type ChartConfig } from "./ui/chart.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible.js";
import { formatTimestamp, resolveBrowserLink } from "./tools-directory.js";

type OverallState = "operational" | "attention" | "outage" | "unknown";

export function ToolsStatus({ snapshot, publicOrigin }: { snapshot: PublicSnapshotDocument; publicOrigin: string }) {
  return <ToolsStatusView snapshot={snapshot} publicOrigin={publicOrigin} />;
}

export function PrivateToolsStatus({ snapshot, actor, publicOrigin }: { snapshot: PrivateSnapshotDocument; actor: string; publicOrigin: string }) {
  return <ToolsStatusView snapshot={privateStatusSnapshot(snapshot)} publicOrigin={publicOrigin} privateView actor={actor} />;
}

function ToolsStatusView({ snapshot, publicOrigin, privateView = false, actor }: { snapshot: PublicSnapshotDocument; publicOrigin: string; privateView?: boolean; actor?: string }) {
  const entries = [...snapshot.entries].sort(byOrderThenId);
  const overall = overallState(entries, snapshot.statuses);
  const unmeasuredCount = entries.filter((entry) => {
    const state = snapshot.statuses[entry.id]?.status;
    return state !== "up" && state !== "down" && state !== "checking";
  }).length;
  const summary = overallSummary(overall, unmeasuredCount);

  return (
    <>
      <AppShell active="status" />
      <div className={`status-page status-page--${overall}`}>
        <main id="main" className="status-wrap status-main">
          <section className="status-hero" aria-labelledby="status-title">
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
          {privateView ? (
            <div className="private-status-identity"><a href="/status">← Public status</a><span>Signed in as {actor}</span></div>
          ) : (
            <section className="private-status-callout" aria-labelledby="private-status-title">
              <div className="private-status-callout__icon" aria-hidden="true"><span className="suite-lock" /></div>
              <div>
                <h2 id="private-status-title">Private service status</h2>
                <p>Sign in with Cloudflare Access to view availability for internal services.</p>
              </div>
              <Button nativeButton={false} variant="link" render={<a href="/manage/status" />}>
                View private status <span aria-hidden="true">›</span>
              </Button>
            </section>
          )}
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
      nativeButton={false}
      variant="secondary"
      className="service-link"
      render={<a href={resolvedHref} {...(sameOrigin ? {} : { target: "_blank", rel: "noreferrer" })} />}
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
  const data = days.map((day) => {
        const uptime = knownDays.get(day);
        const dayRecords = status?.downtimeRecords === undefined
          ? null
          : downtimeRecordsForDay(day, status.downtimeRecords, generatedAt);
        const downtime = dayRecords === null
          ? null
          : dayRecords.reduce((sum, record) => sum + downtimeForDay(day, record, generatedAt), 0);
        const state = uptime === undefined ? "unknown" : uptime.successfulChecks === uptime.totalChecks ? "operational" : uptime.successfulChecks === 0 ? "outage" : "attention";
        const title = uptime === undefined ? `${day} · No check data` : `${day} · ${formatPercentage(uptime.successfulChecks, uptime.totalChecks)} uptime · ${downtime === null ? "Downtime unavailable" : `${formatDuration(downtime)} recorded downtime`} · ${uptime.totalChecks} checks`;
        return { day, value: 1, state, title, uptime: uptime ? formatPercentage(uptime.successfulChecks, uptime.totalChecks) : "No data", checks: uptime?.totalChecks ?? 0, downtime: downtime === null ? "Unavailable" : formatDuration(downtime) };
      });
  const config = { value: { label: "Availability" } } satisfies ChartConfig;
  return <ChartContainer config={config} className="mt-4 h-20 w-full aspect-auto" role="img" aria-label={label} initialDimension={{ width: 900, height: 80 }}>
    <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap={1}>
      <XAxis dataKey="day" hide />
      <ChartTooltip cursor={false} content={({ active, payload }) => active && payload?.[0] ? <div className="grid min-w-44 gap-1 rounded-md border bg-popover p-2 text-xs shadow-xl"><strong>{formatUptimeDate(String(payload[0].payload.day))}</strong><span>{String(payload[0].payload.uptime)} uptime · {String(payload[0].payload.checks)} checks</span><span className="text-muted-foreground">{String(payload[0].payload.downtime)} recorded downtime</span></div> : null} />
      <Bar dataKey="value" radius={2} isAnimationActive={false}>{data.map((item) => <Cell key={item.day} fill={item.state === "operational" ? "#22c55e" : item.state === "attention" ? "#eab308" : item.state === "outage" ? "#ef4444" : "#27272a"} />)}</Bar>
    </BarChart>
  </ChartContainer>;
}

function DowntimeHistory({ status, generatedAt }: { status: PublicMonitorStatus | undefined; generatedAt: string }) {
  const records = status?.downtimeRecords ?? [];
  if (records.length === 0) return null;
  const generatedTime = new Date(generatedAt).getTime();
  const total = records.reduce((sum, record) => sum + downtimeDuration(record, generatedTime), 0);
  return (
    <Collapsible className="downtime-history" aria-label="Downtime records">
      <CollapsibleTrigger className="downtime-history__heading w-full text-left"><h4>Downtime records</h4><span>{records.length} {records.length === 1 ? "interruption" : "interruptions"} · {formatDuration(total)} total · Show details</span></CollapsibleTrigger>
      <CollapsibleContent><ol>{[...records].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((record) => {
        const startedAt = new Date(record.startedAt);
        const resolvedAt = record.resolvedAt ? new Date(record.resolvedAt) : null;
        return (
          <li key={`${record.startedAt}-${record.resolvedAt ?? "open"}`}>
            <LocalDate value={record.startedAt} fallback={formatShortDate(startedAt)} />
            <div><strong><LocalTimeRange start={record.startedAt} end={record.resolvedAt} fallback={resolvedAt ? `${formatClock(startedAt)}–${formatClock(resolvedAt)} UTC` : `${formatClock(startedAt)}–ongoing UTC`} /></strong><span>{resolvedAt ? "Recovered" : "Incident ongoing"}</span></div>
            <span className="downtime-duration">{formatDuration(downtimeDuration(record, generatedTime))}</span>
          </li>
        );
      })}</ol></CollapsibleContent>
    </Collapsible>
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
function formatUptimeDate(day: string) { return formatUtcDate(new Date(`${day}T00:00:00.000Z`)); }
function downtimeRecordsForDay(day: string, records: PublicDowntimeRecord[], generatedAt: string) { return records.filter((record) => downtimeForDay(day, record, generatedAt) > 0); }
function downtimeForDay(day: string, record: PublicDowntimeRecord, generatedAt: string) { const start = new Date(`${day}T00:00:00.000Z`).getTime(); return downtimeDurationInRange(record, new Date(generatedAt).getTime(), start, start + 86400000); }
function downtimeDuration(record: PublicDowntimeRecord, generatedTime: number) { return downtimeDurationInRange(record, generatedTime, new Date(record.startedAt).getTime(), generatedTime); }
function downtimeDurationInRange(record: PublicDowntimeRecord, generatedTime: number, rangeStart: number, rangeEnd: number) { const start = new Date(record.startedAt).getTime(); const end = record.resolvedAt ? new Date(record.resolvedAt).getTime() : generatedTime; return Math.max(0, Math.min(end, rangeEnd, generatedTime) - Math.max(start, rangeStart)); }
function formatDuration(ms: number) { const seconds = Math.max(0, Math.round(ms / 1000)); if (seconds < 60) return `${seconds}s`; const minutes = Math.floor(seconds / 60); if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes} min`; return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`; }
function formatClock(value: Date) { return formatUtcClock(value); }
function formatShortDate(value: Date) { return formatUtcShortDate(value); }
function byOrderThenId<T extends { id: string; order: number }>(a: T, b: T) { return a.order - b.order || a.id.localeCompare(b.id); }
function safeHttpUrl(value: string) { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null; } catch { return null; } }

function privateStatusSnapshot(snapshot: PrivateSnapshotDocument): PublicSnapshotDocument {
  const groupVisibility = new Map(snapshot.catalog.groups.map((group) => [group.id, group.visibility]));
  const entries = snapshot.catalog.entries
    .filter((entry) => entry.lifecycle === "active" && !(entry.visibility === "public" && groupVisibility.get(entry.groupId) === "public"))
    .map((entry) => ({
      id: entry.id,
      groupId: entry.groupId,
      name: entry.name,
      description: entry.description,
      order: entry.order,
      links: entry.links.map(({ id, label, url, access }) => ({ id, label, url, access: access === "private" ? "restricted" as const : access }))
    }));
  const entryIds = new Set(entries.map((entry) => entry.id));
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
      downtimeRecords: snapshot.state.incidents.filter(({ monitorId }) => monitorId === entry.id).map(({ startedAt, resolvedAt }) => ({ startedAt, resolvedAt }))
    };
  }
  return {
    schemaVersion: snapshot.schemaVersion,
    generatedAt: snapshot.generatedAt,
    catalogRevision: snapshot.catalogRevision,
    groups: snapshot.catalog.groups.filter((group) => entries.some((entry) => entry.groupId === group.id)).map(({ id, name, description, order }) => ({ id, name, ...(description === undefined ? {} : { description }), order })),
    entries,
    statuses
  };
}
