import type { PrivateSnapshotDocument, PublicMonitorStatus, PublicSnapshotDocument } from "@tools-platform/domain";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, BookOpen, CircleDollarSign, Cloud, Radio, Send, type LucideIcon } from "lucide-react";
import { AppShell } from "../../src/components/app-shell.js";
import { Badge } from "../../src/components/ui/badge.js";
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
  lime: "border-lime-300/35 bg-lime-300/10 text-lime-200",
  violet: "border-violet-300/35 bg-violet-300/10 text-violet-200",
  amber: "border-amber-300/35 bg-amber-300/10 text-amber-200",
  cyan: "border-cyan-300/35 bg-cyan-300/10 text-cyan-200",
  rose: "border-rose-300/35 bg-rose-300/10 text-rose-200",
  blue: "border-blue-300/35 bg-blue-300/10 text-blue-200"
};

export function ToolsDirectory({ snapshot }: { snapshot: PublicSnapshotDocument | PrivateSnapshotDocument; publicOrigin: string }) {
  const statuses = statusMap(snapshot);
  const operational = products.filter((product) => monitorStatus(product.monitorId, statuses)?.status === "up").length;

  return <>
    <AppShell product="Dashboard" showSignOut />
    <main id="main" className="mx-auto w-[min(1180px,calc(100%_-_2rem))] pb-20 pt-12 sm:pt-20">
      <section className="grid gap-8 border-b border-white/10 pb-12 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-lime-300">Private workspace</p>
          <h1 className="mt-4 max-w-3xl text-5xl font-semibold tracking-[-0.055em] text-white sm:text-7xl">Useful things,<br />close at hand.</h1>
        </div>
        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.035] px-4 py-2 text-sm text-white/65">
          <span className="size-2 rounded-full bg-lime-300" aria-hidden="true" />
          {operational} of {products.length} operational
        </div>
      </section>

      <section className="grid gap-4 pt-8 md:grid-cols-2 xl:grid-cols-3" aria-label="Products">
        {products.map((product, index) => {
          const Icon = productIcons[product.id];
          const status = monitorStatus(product.monitorId, statuses);
          const card = <article className="group flex min-h-56 flex-col justify-between rounded-[2rem] border border-white/10 bg-white/[0.035] p-6 transition-colors hover:border-white/25 hover:bg-white/[0.06]">
            <div className="flex items-start justify-between gap-4">
              <span className={`grid size-14 place-items-center rounded-full border ${accents[product.accent]}`}><Icon className="size-6" aria-hidden="true" /></span>
              <span className="font-mono text-xs text-white/30">{String(index + 1).padStart(2, "0")}</span>
            </div>
            <div className="mt-10">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-2xl font-medium tracking-tight text-white">{product.name}</h2>
                <ArrowUpRight className="size-5 text-white/35 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white" aria-hidden="true" />
              </div>
              <p className="mt-2 text-sm leading-6 text-white/50">{product.description}</p>
              <div className="mt-5 flex items-center gap-2">
                <StatusBadge status={status} />
                <Badge variant="outline">{product.access === "private" ? "Private" : product.access === "tailnet" ? "Tailnet" : "Public"}</Badge>
              </div>
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

export function StatusBadge({ status }: { status: PublicMonitorStatus | undefined }) {
  const label = status?.status === "up" ? "Operational" : status?.status === "down" ? "Unavailable" : status?.status === "paused" ? "Paused" : "Not monitored";
  return <Badge variant={status?.status === "down" ? "destructive" : status?.status === "up" ? "default" : "secondary"}>{label}</Badge>;
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
