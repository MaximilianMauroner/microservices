"use client";

import type { CatalogEntry, PrivateSnapshotDocument, PublicMonitorStatus, PublicSnapshotDocument } from "@tools-platform/domain";
import { Link, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { Activity, ArrowUpRight, CircleOff, CirclePause, Globe2, LockKeyhole, Network, Server, type LucideIcon } from "lucide-react";
import { AppShell } from "../../src/components/app-shell.js";
import { favicons } from "../../src/favicons.js";
import { products, type ProductAccent, type ProductDefinition, type ProductId } from "../products.js";

const REFRESH_INTERVAL_MS = 60_000;

const productIcons: Record<ProductId, string> = {
  feedback: favicons.feedback,
  publisher: favicons.publisher,
  "field-guide": favicons.fieldGuide,
  money: favicons.money,
  status: favicons.status,
  "markdown-share": favicons.markdownShare,
  "network-console": favicons.networkConsole
};

const accents: Record<ProductAccent, string> = {
  lime: "border-lime-300 bg-lime-300 hover:bg-lime-200",
  violet: "border-violet-300 bg-violet-300 hover:bg-violet-200",
  amber: "border-amber-300 bg-amber-300 hover:bg-amber-200",
  cyan: "border-cyan-300 bg-cyan-300 hover:bg-cyan-200",
  rose: "border-rose-300 bg-rose-300 hover:bg-rose-200",
  blue: "border-blue-300 bg-blue-300 hover:bg-blue-200"
};

const catalogAccents = ["violet", "amber", "lime", "cyan", "rose", "blue"] as const satisfies readonly ProductAccent[];

type DirectoryProduct = ProductDefinition & Readonly<{ icon: string | LucideIcon }>;

export function ToolsDirectory({ snapshot }: { snapshot: PublicSnapshotDocument | PrivateSnapshotDocument; publicOrigin: string }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void router.invalidate();
    };
    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  const statuses = statusMap(snapshot);
  const primaryProducts: readonly DirectoryProduct[] = products.map((product) => ({ ...product, icon: productIcons[product.id] }));
  const infrastructureProducts = catalogProducts(snapshot);
  const directoryProducts = [...primaryProducts, ...infrastructureProducts];
  const operational = directoryProducts.filter((product) => monitorStatus(product.monitorId, statuses)?.status === "up").length;

  return <>
    <AppShell product="Dashboard" icon={favicons.directory} showSignOut />
    <main id="main" className="mx-auto w-[min(1180px,calc(100%_-_2rem))] pb-20 pt-8 sm:pt-20">
      <section className="grid gap-6 border-b pb-8 sm:gap-8 sm:pb-12 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Private workspace</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.055em] sm:mt-4 sm:text-7xl">Useful things,<br />close at hand.</h1>
        </div>
        <div className="flex items-center gap-3 rounded-full border bg-card px-4 py-2 text-sm text-muted-foreground">
          <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
          {operational} of {directoryProducts.length} operational
        </div>
      </section>

      <section className="grid gap-3 pt-5 sm:gap-4 sm:pt-8 md:grid-cols-2 xl:grid-cols-4" aria-label="Products">
        {primaryProducts.map((product, index) => {
          const Icon = typeof product.icon === "string" ? undefined : product.icon;
          const status = monitorStatus(product.monitorId, statuses);
          const card = <article className={`group flex min-h-0 flex-row items-center justify-between gap-4 rounded-xl border p-4 text-black transition-colors sm:min-h-56 sm:flex-col sm:items-stretch sm:rounded-2xl sm:p-6 ${accents[product.accent]}`}>
            <div className="flex items-start justify-between gap-4">
              {typeof product.icon === "string"
                ? <img className="size-14 rounded-xl sm:size-20" src={product.icon} alt="" width={80} height={80} />
                : <span className="grid size-11 place-items-center rounded-full border border-black/25 bg-black/10 text-black sm:size-14">{Icon ? <Icon className="size-5 sm:size-6" aria-hidden="true" /> : null}</span>}
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
            : <Link key={product.id} to={product.href as "/feedback" | "/publisher" | "/field-guide" | "/money" | "/status"} preload="intent">{card}</Link>;
        })}
      </section>

      {infrastructureProducts.length > 0 ? (
        <section className="pt-8" aria-labelledby="infrastructure-title">
          <h2 id="infrastructure-title" className="mb-3 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Infrastructure</h2>
          <div className="grid gap-2 md:grid-cols-2">
            {infrastructureProducts.map((product) => {
              const status = monitorStatus(product.monitorId, statuses);
              return (
                <a
                  className="group flex min-w-0 items-center justify-between gap-4 rounded-lg border bg-card px-4 py-3 text-muted-foreground hover:bg-accent hover:text-foreground"
                  href={product.href}
                  key={product.id}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground" aria-hidden="true">
                      <Server className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate text-xs font-semibold text-foreground">{product.name}</strong>
                      <span className="block truncate text-[0.68rem]">{product.description}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-[0.68rem]">
                    <span className={`size-1.5 rounded-full ${status?.status === "up" ? "bg-lime-300" : status?.status === "down" ? "bg-rose-400" : "bg-muted-foreground"}`} aria-hidden="true" />
                    {infrastructureStatus(status)}
                    <ArrowUpRight className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </a>
              );
            })}
          </div>
        </section>
      ) : null}
    </main>
  </>;
}

function catalogProducts(snapshot: PublicSnapshotDocument | PrivateSnapshotDocument): DirectoryProduct[] {
  if (!("catalog" in snapshot)) return [];
  const standardMonitorIds = new Set<string>(products.flatMap(({ monitorId }) => monitorId ? [monitorId] : []));
  return snapshot.catalog.entries
    .filter((entry) => entry.lifecycle === "active" && entry.monitor?.enabled && !standardMonitorIds.has(entry.id))
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
    .flatMap((entry, index) => {
      const link = preferredCatalogLink(entry);
      if (!link) return [];
      return [{
        id: `catalog:${entry.id}`,
        name: entry.name,
        description: entry.description,
        href: link.url,
        access: catalogAccess(entry, link.url),
        accent: catalogAccents[index % catalogAccents.length]!,
        monitorId: entry.id,
        external: true,
        icon: Server
      } satisfies DirectoryProduct];
    });
}

function preferredCatalogLink(entry: CatalogEntry) {
  return entry.links.find(({ access }) => access === "private") ?? entry.links.find(({ access }) => access === "restricted") ?? entry.links[0];
}

function catalogAccess(entry: CatalogEntry, href: string): ProductDefinition["access"] {
  if (entry.monitor?.scope === "tailscale" || new URL(href).hostname.endsWith(".ts.net")) return "tailnet";
  return entry.visibility === "public" && entry.links.some(({ url, access }) => url === href && access === "public") ? "public" : "private";
}

function statusMap(snapshot: PublicSnapshotDocument | PrivateSnapshotDocument) {
  if (!("catalog" in snapshot)) return snapshot.statuses;
  return Object.fromEntries(snapshot.catalog.entries.flatMap((entry) => {
    if (!entry.monitor?.enabled) return [];
    const monitor = snapshot.state.monitors[entry.id];
    return [[entry.id, {
      monitorId: entry.id,
      status: monitor?.status ?? (entry.monitor.paused ? "paused" : "checking"),
      checkedAt: monitor?.latestObservation?.checkedAt ?? null,
      latencyMs: monitor?.latestObservation?.latencyMs ?? null,
      statusCode: monitor?.latestObservation?.statusCode ?? null,
      uptimeDays: [],
      downtimeRecords: []
    } satisfies PublicMonitorStatus]];
  }));
}

function monitorStatus(id: string | undefined, statuses: Record<string, PublicMonitorStatus>) {
  return id ? statuses[id] : undefined;
}

function infrastructureStatus(status: PublicMonitorStatus | undefined) {
  if (status?.status === "up") return "Operational";
  if (status?.status === "down") return "Unavailable";
  if (status?.status === "paused") return "Paused";
  if (status?.status === "checking") return "Checking";
  return "Not monitored";
}

function ProductMetadata({ access, status }: { access: "private" | "tailnet" | "public"; status: PublicMonitorStatus | undefined }) {
  const AccessIcon = access === "private" ? LockKeyhole : access === "tailnet" ? Network : Globe2;
  const accessLabel = access === "private" ? "Private" : access === "tailnet" ? "Tailnet" : "Public";
  const StatusIcon = status?.status === "up" ? Activity : status?.status === "down" ? CircleOff : status?.status === "paused" ? CirclePause : status?.status === "checking" ? Activity : CircleOff;
  const statusLabel = status?.status === "up" ? "Operational" : status?.status === "down" ? "Unavailable" : status?.status === "paused" ? "Paused" : status?.status === "checking" ? "Checking" : status?.status === "unavailable" ? "Not reachable here" : "Not monitored";
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
