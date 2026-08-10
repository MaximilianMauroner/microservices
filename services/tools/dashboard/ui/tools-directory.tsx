import type { PrivateSnapshotDocument, PublicMonitorStatus, PublicSnapshotDocument } from "@tools-platform/domain";
import { Link } from "@tanstack/react-router";
import { Activity, ArrowUpRight, BookOpen, CircleDollarSign, CircleOff, CirclePause, Cloud, Globe2, LockKeyhole, Network, Radio, Send, type LucideIcon } from "lucide-react";
import { AppShell } from "../../src/components/app-shell.js";
import { products, type ProductAccent, type ProductId } from "../products.js";

const productIcons: Record<ProductId, LucideIcon> = {
  publisher: Send,
  "field-guide": BookOpen,
  money: CircleDollarSign,
  status: Radio,
  "markdown-share": Cloud,
  "network-console": Radio
};

const accents: Record<ProductAccent, string> = {
  lime: "border-lime-300 bg-lime-300 hover:bg-lime-200",
  violet: "border-violet-300 bg-violet-300 hover:bg-violet-200",
  amber: "border-amber-300 bg-amber-300 hover:bg-amber-200",
  cyan: "border-cyan-300 bg-cyan-300 hover:bg-cyan-200",
  rose: "border-rose-300 bg-rose-300 hover:bg-rose-200",
  blue: "border-blue-300 bg-blue-300 hover:bg-blue-200"
};

export function ToolsDirectory({ snapshot }: { snapshot: PublicSnapshotDocument | PrivateSnapshotDocument; publicOrigin: string }) {
  const statuses = statusMap(snapshot);
  const operational = products.filter((product) => monitorStatus(product.monitorId, statuses)?.status === "up").length;

  return <>
    <AppShell product="Dashboard" showSignOut />
    <main id="main" className="mx-auto w-[min(1180px,calc(100%_-_2rem))] pb-20 pt-8 sm:pt-20">
      <section className="grid gap-6 border-b pb-8 sm:gap-8 sm:pb-12 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Private workspace</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.055em] sm:mt-4 sm:text-7xl">Useful things,<br />close at hand.</h1>
        </div>
        <div className="flex items-center gap-3 rounded-full border bg-card px-4 py-2 text-sm text-muted-foreground">
          <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
          {operational} of {products.length} operational
        </div>
      </section>

      <section className="grid gap-3 pt-5 sm:gap-4 sm:pt-8 md:grid-cols-2 xl:grid-cols-3" aria-label="Products">
        {products.map((product, index) => {
          const Icon = productIcons[product.id];
          const status = monitorStatus(product.monitorId, statuses);
          const card = <article className={`group flex min-h-0 flex-row items-center justify-between gap-4 rounded-xl border p-4 text-black transition-colors sm:min-h-56 sm:flex-col sm:items-stretch sm:rounded-2xl sm:p-6 ${accents[product.accent]}`}>
            <div className="flex items-start justify-between gap-4">
              <span className="grid size-11 place-items-center rounded-full border border-black/25 bg-black/10 text-black sm:size-14"><Icon className="size-5 sm:size-6" aria-hidden="true" /></span>
              <span className="hidden font-mono text-xs text-black/45 sm:block">{String(index + 1).padStart(2, "0")}</span>
            </div>
            <div className="min-w-0 flex-1 sm:mt-10 sm:flex-none">
              <div className="flex items-center justify-between gap-3">
                <h2 className="truncate text-lg font-medium tracking-tight sm:text-2xl">{product.name}</h2>
                <ArrowUpRight className="size-5 text-black/55 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-black" aria-hidden="true" />
              </div>
              <p className="mt-1 truncate text-xs text-black/65 sm:mt-2 sm:text-sm sm:leading-6">{product.description}</p>
              <ProductMetadata access={product.access} status={status} />
            </div>
          </article>;
          return product.external
            ? <a key={product.id} href={product.href} target="_blank" rel="noreferrer">{card}</a>
            : <Link key={product.id} to={product.href as "/publisher" | "/field-guide" | "/money" | "/status"} preload="intent">{card}</Link>;
        })}
      </section>
    </main>
  </>;
}

function statusMap(snapshot: PublicSnapshotDocument | PrivateSnapshotDocument) {
  if (!("catalog" in snapshot)) return snapshot.statuses;
  return Object.fromEntries(Object.entries(snapshot.state.monitors).map(([id, monitor]) => [id, {
    monitorId: id,
    status: monitor.status,
    checkedAt: monitor.latestObservation?.checkedAt ?? null,
    latencyMs: monitor.latestObservation?.latencyMs ?? null,
    statusCode: monitor.latestObservation?.statusCode ?? null,
    uptimeDays: [],
    downtimeRecords: []
  } satisfies PublicMonitorStatus]));
}

function monitorStatus(id: string | undefined, statuses: Record<string, PublicMonitorStatus>) {
  return id ? statuses[id] : undefined;
}

function ProductMetadata({ access, status }: { access: "private" | "tailnet" | "public"; status: PublicMonitorStatus | undefined }) {
  const AccessIcon = access === "private" ? LockKeyhole : access === "tailnet" ? Network : Globe2;
  const accessLabel = access === "private" ? "Private" : access === "tailnet" ? "Tailnet" : "Public";
  const StatusIcon = status?.status === "up" ? Activity : status?.status === "down" ? CircleOff : status?.status === "paused" ? CirclePause : CircleOff;
  const statusLabel = status?.status === "up" ? "Operational" : status?.status === "down" ? "Unavailable" : status?.status === "paused" ? "Paused" : "Not monitored";
  const statusTone = status?.status === "down" ? "text-black" : "text-black/70";

  return <div className="mt-2 flex items-center gap-2 text-black/70 sm:mt-5">
    <MetadataIcon icon={AccessIcon} label={accessLabel} />
    <MetadataIcon icon={StatusIcon} label={statusLabel} className={statusTone} />
  </div>;
}

function MetadataIcon({ icon: Icon, label, className = "" }: { icon: LucideIcon; label: string; className?: string }) {
  return <span className={`group/meta relative grid size-7 place-items-center rounded-md border border-black/20 bg-black/10 ${className}`} tabIndex={0} aria-label={label}>
    <Icon className="size-3.5" aria-hidden="true" />
    <span className="pointer-events-none absolute bottom-[calc(100%+0.4rem)] left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[0.65rem] font-medium text-background opacity-0 shadow-lg transition-opacity group-hover/meta:opacity-100 group-focus/meta:opacity-100">{label}</span>
  </span>;
}

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
