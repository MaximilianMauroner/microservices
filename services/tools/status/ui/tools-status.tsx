import type {
  PublicCatalogEntry,
  PublicDowntimeRecord,
  PublicMonitorStatus,
  PublicSnapshotDocument,
  PrivateSnapshotDocument
} from "@tools-platform/domain";
import { Link } from "@tanstack/react-router";
import { Fragment, useState, type ReactNode } from "react";
import { ArrowUpRight, CheckIcon, ChevronRight, CircleHelpIcon, EyeOffIcon, LockKeyhole, TriangleAlertIcon } from "lucide-react";
import { AppShell } from "../../src/components/app-shell.js";
import { PageHeader } from "../../src/components/page-header.js";
import { favicons } from "../../src/favicons.js";
import { LocalDate, LocalTimeRange, LocalTimestamp } from "../../src/components/local-time.js";
import { Button } from "../../src/components/ui/button.js";
import { Card } from "../../src/components/ui/card.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../src/components/ui/table.js";
import { useIsMobile } from "../../src/components/ui/use-mobile.js";
import { resolveBrowserLink } from "../../dashboard/ui/tools-directory-helpers.js";
import { projectPrivateCatalog } from "../../dashboard/ui/private-catalog-projection.js";
import { countLabel } from "../../src/lib/count-label.js";
import { formatDateTime } from "../../src/lib/format-date.js";
import { cn } from "../../src/lib/utils.js";

type OverallState = "operational" | "attention" | "outage" | "unknown";
type DayState = "operational" | "attention" | "outage" | "unknown";
interface Service { entry: PublicCatalogEntry; status: PublicMonitorStatus | undefined }

const DAY_MS = 86_400_000;

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
  const services = [...snapshot.entries].sort(byOrderThenId).map((entry) => ({ entry, status: snapshot.statuses[entry.id] }));
  const lastCheck = services.map(({ status }) => status?.checkedAt).filter((value): value is string => Boolean(value)).sort().at(-1);

  return (
    <>
      <AppShell product="Status" accent="cyan" icon={favicons.status} />
      <main id="main" className="tools-page">
        <PageHeader
          title="Status"
          facts={<>Checked every 30 minutes · {lastCheck ? <>last check <LocalTimestamp value={lastCheck} fallback={formatDateTime(lastCheck)} /></> : "no checks yet"}</>}
        />
        <div className="grid gap-3">
          <SummaryCard services={services} generatedAt={snapshot.generatedAt} />
          {services.length === 0 ? (
            <Card className="items-center gap-1 px-4 py-10 text-center">
              <h2 className="font-semibold">No services published yet</h2>
              <p className="text-muted-foreground">The status catalog is being prepared.</p>
            </Card>
          ) : (
            <ServicesTable services={services} generatedAt={snapshot.generatedAt} publicOrigin={publicOrigin} />
          )}
          <IncidentsCard services={services} generatedAt={snapshot.generatedAt} />
          {view === "private" ? (
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <Link className="hover:text-foreground" to="/status" preload="intent">← All services</Link>
              <span>Signed in as {actor}</span>
            </div>
          ) : view === "public" ? (
            <Card className="flex-row flex-wrap items-center gap-3 px-4 py-3">
              <LockKeyhole className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">Private service status</h2>
                <p className="text-muted-foreground">Sign in with Google to view availability for internal services.</p>
              </div>
              <Button variant="outline" size="sm" render={<Link to="/" preload="intent" />}>
                Open Tools <ChevronRight aria-hidden="true" />
              </Button>
            </Card>
          ) : null}
        </div>
      </main>
    </>
  );
}

function SummaryCard({ services, generatedAt }: { services: Service[]; generatedAt: string }) {
  const state = overallState(services);
  const window = new Set(rollingDays(generatedAt));
  const days = services.flatMap(({ status }) => (status?.uptimeDays ?? []).filter(({ day }) => window.has(day)));
  const totalChecks = days.reduce((sum, day) => sum + day.totalChecks, 0);
  const successfulChecks = days.reduce((sum, day) => sum + day.successfulChecks, 0);
  const latency = median(services.flatMap(({ status }) => status?.latencyMs ?? []));
  const operational = services.filter(({ status }) => status?.status === "up").length;
  const stats = [
    ["Operational", `${operational} of ${services.length}`],
    ["Uptime, 90 days", totalChecks === 0 ? "No data" : formatPercentage(successfulChecks, totalChecks)],
    ["Incidents, 30 days", String(recentIncidents(services, generatedAt).length)],
    ["Median latency", latency === null ? "No data" : `${latency} ms`]
  ];
  return (
    <Card className="gap-0 py-0" aria-labelledby="status-summary-title">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <StatusMark state={state} />
        <div className="min-w-0">
          <h2 id="status-summary-title" className="text-[1.0625rem] font-semibold">{summaryTitle(state, services)}</h2>
          <p className="text-[0.8125rem] text-muted-foreground">{summaryDetail(state, services)}</p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-px border-t bg-border md:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="min-w-0 bg-card px-4 py-2.5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-lg font-semibold tracking-[-0.01em] tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function summaryTitle(state: OverallState, services: Service[]) {
  if (state === "outage") {
    const down = services.filter(({ status }) => status?.status === "down").length;
    return `${countLabel(down, "service")} ${down === 1 ? "is" : "are"} down`;
  }
  if (state === "attention") return "Some service results are inconclusive";
  if (state === "operational") return "All services operational";
  return "Monitoring visibility is limited";
}

function summaryDetail(state: OverallState, services: Service[]): ReactNode {
  const unmeasured = services.filter(({ status }) => !status || status.status === "paused" || status.status === "unavailable").length;
  const coverage = unmeasured === 0 ? "" : ` ${countLabel(unmeasured, "service")} ${unmeasured === 1 ? "is" : "are"} not measured.`;
  if (state === "attention") return `The latest check did not give a clear result. The next check can update this status.${coverage}`;
  if (state === "operational") return `No service is down.${coverage}`;
  if (state === "unknown") return "No service has a measured result yet.";
  const down = services.filter(({ status }) => status?.status === "down");
  const others = services.length - down.length;
  const up = services.filter(({ status }) => status?.status === "up").length;
  const since = (service: Service) => {
    const value = downSince(service.status);
    return value ? <LocalTimestamp value={value} fallback={formatDateTime(value)} /> : null;
  };
  const rest = others === 0 ? "" : up === others
    ? others === 1 ? " The other service is operational." : ` The other ${others} services are operational.`
    : ` ${up} of the other ${countLabel(others, "service")} ${up === 1 ? "is" : "are"} operational.`;
  const [first] = down;
  if (down.length === 1 && first) {
    const time = since(first);
    return <>{first.entry.name} has not answered{time ? <> since {time}</> : null}.{rest}</>;
  }
  return <>Not answering: {down.map((service, index) => {
    const time = since(service);
    return <Fragment key={service.entry.id}>{index > 0 ? ", " : ""}{service.entry.name}{time ? <> since {time}</> : null}</Fragment>;
  })}.{rest}</>;
}

function StatusMark({ state }: { state: OverallState }) {
  const label = state === "operational" ? "Operational" : state === "outage" ? "Service interruption" : state === "attention" ? "Inconclusive" : "Limited visibility";
  const Icon = state === "operational" ? CheckIcon : state === "outage" ? TriangleAlertIcon : state === "attention" ? CircleHelpIcon : EyeOffIcon;
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground",
        state === "operational" && "bg-positive/15 text-positive",
        state === "outage" && "bg-negative/15 text-negative",
        state === "attention" && "bg-warning/15 text-warning"
      )}
    >
      <Icon className="size-[18px]" aria-hidden="true" />
    </span>
  );
}

function ServicesTable({ services, generatedAt, publicOrigin }: { services: Service[]; generatedAt: string; publicOrigin: string }) {
  const isMobile = useIsMobile();
  const [openId, setOpenId] = useState<string>();
  return (
    <Card className="gap-0 py-0" aria-label="Services">
      <Table className={cn("text-[0.8125rem]", isMobile && "table-fixed")}>
        <TableHeader>
          <TableRow className="text-xs hover:bg-transparent [&>th]:font-normal [&>th]:text-muted-foreground">
            {isMobile ? <TableHead className="px-4">Service · last 90 days</TableHead> : <>
              <TableHead className="pl-4">Service</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Last 90 days · today at right</TableHead>
              <TableHead className="text-right">Uptime</TableHead>
              <TableHead className="pr-4 text-right">Latency</TableHead>
            </>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {services.map((service) => (
            <ServiceRows
              key={service.entry.id}
              service={service}
              generatedAt={generatedAt}
              publicOrigin={publicOrigin}
              compact={isMobile}
              open={openId === service.entry.id}
              onToggle={() => setOpenId((current) => current === service.entry.id ? undefined : service.entry.id)}
            />
          ))}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t px-4 py-2.5 text-xs text-muted-foreground">
        <span className="flex flex-wrap gap-x-3 gap-y-1" aria-hidden="true">
          {(["operational", "attention", "outage", "unknown"] as const).map((state) => (
            <span key={state} className="inline-flex items-center gap-1.5"><span className={cn("size-2 rounded-full", dayTone[state])} />{dayLabel[state]}</span>
          ))}
        </span>
        <span>Select a row for details</span>
      </div>
    </Card>
  );
}

const dayTone: Record<DayState, string> = { operational: "bg-positive", attention: "bg-warning", outage: "bg-negative", unknown: "bg-foreground/20" };
const dayLabel: Record<DayState, string> = { operational: "Up", attention: "Some checks failed", outage: "Down", unknown: "No data" };

function ServiceRows({ service, generatedAt, publicOrigin, compact, open, onToggle }: {
  service: Service;
  generatedAt: string;
  publicOrigin: string;
  compact: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { entry, status } = service;
  const uptime = uptimeSummary(status, generatedAt);
  const state = serviceStateLabel(status, generatedAt);
  const down = status?.status === "down";
  const detailId = `status-detail-${entry.id}`;
  // The row takes the click. The button gives keyboard and screen reader access; its click bubbles to the row.
  const name = <button type="button" aria-expanded={open} aria-controls={open ? detailId : undefined} className="block max-w-full cursor-pointer truncate text-left font-medium outline-none focus-visible:underline">{entry.name}</button>;
  const bar = <UptimeBar status={status} generatedAt={generatedAt} summary={uptime} />;
  const uptimeText = uptime.percentage === null ? "No data" : formatPercentage(uptime.successful, uptime.totalChecks);
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        {compact ? (
          <TableCell className="px-4 py-2.5 whitespace-normal">
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2.5"><ServiceDot status={status} />{name}</span>
              <span className={cn("shrink-0 text-xs", down ? "text-negative" : "text-muted-foreground")}>{state} · {uptimeText}</span>
            </div>
            <div className="mt-2">{bar}</div>
          </TableCell>
        ) : <>
          <TableCell className="py-2.5 pl-4">
            <div className="flex max-w-72 min-w-44 items-center gap-2.5">
              <ServiceDot status={status} />
              <div className="min-w-0">
                {name}
                <span className="block truncate text-xs text-muted-foreground">{entry.description}</span>
              </div>
            </div>
          </TableCell>
          <TableCell className={cn("py-2.5", down && "text-negative")}>{state}</TableCell>
          <TableCell className="w-full py-2.5">{bar}</TableCell>
          <TableCell className="py-2.5 text-right tabular-nums">{uptime.percentage === null ? "—" : uptimeText}</TableCell>
          <TableCell className="py-2.5 pr-4 text-right tabular-nums">{status?.latencyMs == null ? "—" : `${status.latencyMs} ms`}</TableCell>
        </>}
      </TableRow>
      {open ? (
        <TableRow id={detailId} className="bg-muted/45 hover:bg-muted/45">
          <TableCell colSpan={compact ? 1 : 5} className="px-4 pt-2.5 pb-3.5 whitespace-normal">
            <ServiceDetails service={service} generatedAt={generatedAt} publicOrigin={publicOrigin} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function ServiceDot({ status }: { status: PublicMonitorStatus | undefined }) {
  const tone = status?.status === "up" ? "bg-positive" : status?.status === "down" ? "bg-negative" : status?.status === "checking" ? "bg-warning" : "bg-muted-foreground";
  return <span className={cn("size-2 shrink-0 rounded-full", tone)} aria-hidden="true" />;
}

function ServiceDetails({ service: { entry, status }, generatedAt, publicOrigin }: { service: Service; generatedAt: string; publicOrigin: string }) {
  const generatedTime = new Date(generatedAt).getTime();
  const windowStart = new Date(`${rollingDays(generatedAt)[0]}T00:00:00.000Z`).getTime();
  const records = (status?.downtimeRecords ?? [])
    .filter((record) => recordEnd(record, generatedTime) > windowStart)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const links = entry.links.flatMap((link) => {
    const destination = safeHttpUrl(link.url);
    return destination ? [{ ...link, destination }] : [];
  });
  return (
    <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
      <div>
        <h3 className="mb-1 text-xs text-muted-foreground">Latest check</h3>
        <p><LatestCheck status={status} /></p>
        <h3 className="mt-2.5 mb-1 text-xs text-muted-foreground">Downtime, last 90 days</h3>
        {records.length === 0 ? <p>No downtime recorded.</p> : (
          <ul aria-label={`${entry.name} downtime records`}>
            {records.map((record) => (
              <li key={`${record.startedAt}-${record.resolvedAt ?? "open"}`} className={cn(!record.resolvedAt && "text-negative")}>
                <DowntimeRange record={record} withDate /> · {formatDuration(downtimeDuration(record, generatedTime))}
              </li>
            ))}
          </ul>
        )}
      </div>
      {links.length > 0 ? (
        <div>
          <h3 className="mb-1 text-xs text-muted-foreground">Links</h3>
          <div className="flex flex-wrap gap-2" role="group" aria-label={`${entry.name} links`}>
            {links.map((link) => (
              <ServiceLink key={link.id} href={link.destination} label={link.label} restricted={link.access === "restricted"} publicOrigin={publicOrigin} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LatestCheck({ status }: { status: PublicMonitorStatus | undefined }) {
  if (!status) return <>No automated check</>;
  if (!status.checkedAt) return <>{status.status === "unavailable" ? "Not checkable from Railway" : "Awaiting first check"}</>;
  const metrics = [
    status.latencyMs !== null ? `${status.latencyMs} ms` : status.status === "down" ? "No response" : null,
    status.statusCode === null ? null : `HTTP ${status.statusCode}`
  ].filter(Boolean);
  return <><LocalTimestamp value={status.checkedAt} fallback={formatDateTime(status.checkedAt)} />{metrics.length ? ` · ${metrics.join(" · ")}` : ""}</>;
}

function DowntimeRange({ record, withDate = false }: { record: PublicDowntimeRecord; withDate?: boolean }) {
  const startedAt = new Date(record.startedAt);
  const resolvedAt = record.resolvedAt ? new Date(record.resolvedAt) : null;
  return <>
    {withDate ? <><LocalDate value={record.startedAt} fallback={formatShortDate(startedAt)} />{" "}</> : null}
    <LocalTimeRange start={record.startedAt} end={record.resolvedAt} fallback={`${formatClock(startedAt)}–${resolvedAt ? formatClock(resolvedAt) : "ongoing"} UTC`} />
  </>;
}

function ServiceLink({ href, label, restricted, publicOrigin }: { href: string; label: string; restricted: boolean; publicOrigin: string }) {
  const resolvedHref = resolveBrowserLink(href, publicOrigin);
  const sameOrigin = resolvedHref !== href;
  return (
    <Button
      variant="outline"
      size="sm"
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
  const label = summary.percentage === null
    ? `Observed uptime is not available. 0 recorded days and ${countLabel(summary.noDataDays, "no-data day")}.`
    : `Observed uptime: ${formatPercentage(summary.successful, summary.totalChecks)} across ${countLabel(summary.totalChecks, "check")}; ${countLabel(summary.recordedDays, "recorded day")} and ${countLabel(summary.noDataDays, "no-data day")}.`;
  return (
    <div className="grid h-[22px] min-w-36 grid-cols-[repeat(90,minmax(1px,1fr))] gap-px" role="group" aria-label={label}>
      {rollingDays(generatedAt).map((day) => {
        const uptime = knownDays.get(day);
        const state: DayState = uptime === undefined ? "unknown" : uptime.successfulChecks === uptime.totalChecks ? "operational" : uptime.successfulChecks === 0 ? "outage" : "attention";
        const downtime = status?.downtimeRecords === undefined
          ? null
          : status.downtimeRecords.reduce((sum, record) => sum + downtimeForDay(day, record, generatedAt), 0);
        const title = uptime === undefined
          ? `${formatUptimeDate(day)} · No check data`
          : `${formatUptimeDate(day)} · ${formatPercentage(uptime.successfulChecks, uptime.totalChecks)} uptime · ${downtime === null ? "Downtime unavailable" : `${formatDuration(downtime)} recorded downtime`} · ${countLabel(uptime.totalChecks, "check")}`;
        return <span key={day} className={cn("rounded-[1px]", dayTone[state])} role="img" aria-label={title} title={title} />;
      })}
    </div>
  );
}

function IncidentsCard({ services, generatedAt }: { services: Service[]; generatedAt: string }) {
  const incidents = recentIncidents(services, generatedAt);
  const generatedTime = new Date(generatedAt).getTime();
  return (
    <Card className="gap-0 py-0" aria-labelledby="status-incidents-title">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pt-3 pb-1.5">
        <h2 id="status-incidents-title" className="font-semibold">Incidents</h2>
        <span className="text-xs text-muted-foreground">Last 30 days</span>
      </div>
      {incidents.length === 0 ? <p className="px-4 pb-3 text-[0.8125rem] text-muted-foreground">No incidents in the last 30 days.</p> : (
        <ol>
          {incidents.map(({ service, record }) => (
            <li key={`${service.id}-${record.startedAt}`} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-baseline gap-2.5 border-t px-4 py-2 text-[0.8125rem] first:border-t-0">
              <span className="text-xs text-muted-foreground tabular-nums"><LocalDate value={record.startedAt} fallback={formatShortDate(new Date(record.startedAt))} /></span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{service.name}</span>
                <span className="block text-xs text-muted-foreground"><DowntimeRange record={record} /></span>
              </span>
              <span className={cn("tabular-nums", !record.resolvedAt && "text-negative")}>{formatDuration(downtimeDuration(record, generatedTime))}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** Downtime records that overlap the last 30 days, newest first. */
function recentIncidents(services: Service[], generatedAt: string) {
  const generatedTime = new Date(generatedAt).getTime();
  const cutoff = generatedTime - 30 * DAY_MS;
  return services
    .flatMap(({ entry, status }) => (status?.downtimeRecords ?? []).map((record) => ({ service: entry, record })))
    .filter(({ record }) => recordEnd(record, generatedTime) > cutoff)
    .sort((a, b) => b.record.startedAt.localeCompare(a.record.startedAt));
}

function serviceStateLabel(status: PublicMonitorStatus | undefined, generatedAt: string) {
  if (!status) return "Not monitored";
  if (status.status === "up") return "Operational";
  if (status.status === "checking") return "Inconclusive";
  if (status.status === "paused") return "Paused";
  if (status.status === "unavailable") return "Not measured";
  const since = downSince(status);
  return since ? `Down ${formatDuration(new Date(generatedAt).getTime() - new Date(since).getTime())}` : "Down";
}

/** Start of the ongoing downtime record, or the failed check when no record is open. */
function downSince(status: PublicMonitorStatus | undefined) {
  if (status?.status !== "down") return null;
  const ongoing = status.downtimeRecords?.filter((record) => record.resolvedAt === null).sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
  return ongoing?.startedAt ?? status.checkedAt;
}

function overallState(services: Service[]): OverallState {
  const monitored = services.flatMap(({ status }) => status ? [status] : []);
  if (monitored.some(({ status }) => status === "down")) return "outage";
  if (monitored.some(({ status }) => status === "checking")) return "attention";
  if (monitored.some(({ status }) => status === "up") && monitored.every(({ status }) => status === "up" || status === "paused" || status === "unavailable")) return "operational";
  return "unknown";
}

interface UptimeSummary { percentage: number | null; successful: number; totalChecks: number; recordedDays: number; noDataDays: number }

function uptimeSummary(status: PublicMonitorStatus | undefined, generatedAt: string): UptimeSummary {
  const window = new Set(rollingDays(generatedAt));
  const days = (status?.uptimeDays ?? []).filter(({ day }) => window.has(day));
  const successful = days.reduce((sum, day) => sum + day.successfulChecks, 0);
  const total = days.reduce((sum, day) => sum + day.totalChecks, 0);
  const recordedDays = days.filter(({ totalChecks }) => totalChecks > 0).length;
  return { percentage: total === 0 ? null : successful / total * 100, successful, totalChecks: total, recordedDays, noDataDays: 90 - recordedDays };
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] ?? null : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

function rollingDays(generatedAt: string) { const end = new Date(generatedAt); end.setUTCHours(0, 0, 0, 0); return Array.from({ length: 90 }, (_, index) => { const day = new Date(end); day.setUTCDate(day.getUTCDate() - (89 - index)); return day.toISOString().slice(0, 10); }); }
/** Truncates to two decimals so a single failed check never rounds up to 100%. */
function formatPercentage(successful: number, total: number) { const value = Math.floor(successful / total * 10_000) / 100; return `${value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`; }
function formatUptimeDate(day: string) { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00.000Z`)); }
function downtimeForDay(day: string, record: PublicDowntimeRecord, generatedAt: string) { const start = new Date(`${day}T00:00:00.000Z`).getTime(); return downtimeDurationInRange(record, new Date(generatedAt).getTime(), start, start + DAY_MS); }
function recordEnd(record: PublicDowntimeRecord, generatedTime: number) { return record.resolvedAt ? new Date(record.resolvedAt).getTime() : generatedTime; }
function downtimeDuration(record: PublicDowntimeRecord, generatedTime: number) { return downtimeDurationInRange(record, generatedTime, new Date(record.startedAt).getTime(), generatedTime); }
function downtimeDurationInRange(record: PublicDowntimeRecord, generatedTime: number, rangeStart: number, rangeEnd: number) { const start = new Date(record.startedAt).getTime(); return Math.max(0, Math.min(recordEnd(record, generatedTime), rangeEnd, generatedTime) - Math.max(start, rangeStart)); }
function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  return hours % 24 ? `${Math.floor(hours / 24)} d ${hours % 24} h` : `${Math.floor(hours / 24)} d`;
}
function formatClock(value: Date) { return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(value); }
function formatShortDate(value: Date) { return new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric", timeZone: "UTC" }).format(value); }
function byOrderThenId<T extends { id: string; order: number }>(a: T, b: T) { return a.order - b.order || a.id.localeCompare(b.id); }
function safeHttpUrl(value: string) { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null; } catch { return null; } }
