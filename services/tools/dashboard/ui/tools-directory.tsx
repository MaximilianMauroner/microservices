"use client";

import type { CatalogEntry, PrivateSnapshotDocument, PublicMonitorStatus, PublicSnapshotDocument } from "@tools-platform/domain";
import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, type ReactElement, type ReactNode } from "react";
import { ArrowUpRight, CheckCircle2, ChevronRight } from "lucide-react";
import type { AttentionSummary, DashboardData } from "../../src/attention.js";
import { AppShell } from "../../src/components/app-shell.js";
import { PageHeader } from "../../src/components/page-header.js";
import { Button } from "../../src/components/ui/button.js";
import { favicons } from "../../src/favicons.js";
import { countLabel } from "../../src/lib/count-label.js";
import { products, type ProductDefinition, type ProductId } from "../products.js";

const REFRESH_INTERVAL_MS = 60_000;
const TIME_ZONE = "Europe/Berlin";
const dayFormatter = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: TIME_ZONE });
const clockFormatter = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE });

const productIcons: Record<ProductId, string> = {
  feedback: favicons.feedback,
  publisher: favicons.publisher,
  money: favicons.money,
  status: favicons.status,
  "markdown-share": favicons.markdownShare,
  "network-console": favicons.networkConsole
};

type Snapshot = PublicSnapshotDocument | PrivateSnapshotDocument;
type CatalogProduct = Pick<ProductDefinition, "id" | "name" | "description" | "href" | "monitorId">;
type NeedsItem = { key: string; icon: string; text: string; tool: string; link: ReactNode; urgent: boolean };

export function ToolsDirectory({ snapshot, attention = {}, facts = {} }: { snapshot: Snapshot; publicOrigin: string; attention?: AttentionSummary; facts?: DashboardData["facts"] }) {
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
  const infrastructure = catalogProducts(snapshot);
  const monitorIds = new Set([...products, ...infrastructure].flatMap((product) => product.monitorId ? [product.monitorId] : []));
  const operational = [...monitorIds].filter((id) => statuses[id]?.status === "up").length;
  const healthTone = operational === monitorIds.size ? "bg-positive" : operational === 0 ? "bg-negative" : "bg-warning";
  const now = new Date(snapshot.generatedAt).getTime();
  const needs = needsItems(attention, now);

  return <>
    <AppShell product="Dashboard" icon={favicons.directory} />
    <main id="main" className="tools-page">
      <PageHeader
        title="Dashboard"
        facts={`${dayFormatter.format(new Date(snapshot.generatedAt))} · ${needs.length ? `${countLabel(needs.length, "thing")} need${needs.length === 1 ? "s" : ""} you` : "nothing needs you"}`}
        actions={<span className="inline-flex h-8 items-center gap-2 rounded-full border bg-card px-3 text-sm text-muted-foreground"><span className={`size-2 rounded-full ${healthTone}`} aria-hidden="true" />{attention.servicesDown?.length ? `${countLabel(attention.servicesDown.length, "service")} down` : monitorIds.size - operational ? `${monitorIds.size - operational} checks need attention` : `${operational} of ${monitorIds.size} checks passing`}</span>}
      />
      <div className="grid grid-cols-1 gap-3">
        <section className="rounded-xl bg-card ring-1 ring-[color:var(--surface-border)]" aria-labelledby="needs-title">
          <div className="flex items-center justify-between gap-3 px-4 pt-3"><h2 id="needs-title" className="text-sm font-semibold">Needs you</h2><span className="text-xs text-muted-foreground">Ordered by urgency</span></div>
          {needs.length ? <div className="mt-2">{([true, false] as const).map((urgent) => needs.some((item) => item.urgent === urgent) ? <div key={String(urgent)} className="border-t border-border/60 py-1"><h3 className="px-4 py-1.5 text-xs font-medium text-muted-foreground">{urgent ? "Time-sensitive" : "Ready to review"}</h3><ul className="divide-y divide-border/40" role="list">
            {needs.filter((item) => item.urgent === urgent).map((item) => <li key={item.key} className="flex min-w-0 items-center gap-3 px-4 py-2.5">
              <img className="size-5 shrink-0 rounded" src={item.icon} alt="" width={20} height={20} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.text}</span><span className="block truncate text-xs text-muted-foreground">{item.tool}</span></span>
              {item.link}
            </li>)}
          </ul></div> : null)}</div> : <p className="flex items-center gap-2 px-4 pb-4 pt-2 text-sm text-muted-foreground"><CheckCircle2 className="size-4 text-positive" aria-hidden="true" />Nothing needs you right now.</p>}
        </section>

        <section aria-labelledby="workspace-title"><h2 id="workspace-title" className="mb-2 text-sm font-semibold">Your tools</h2><div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => {
            const card = <>
              <span className="flex min-w-0 items-center gap-2.5">
                <img className="size-8 shrink-0 rounded-lg" src={productIcons[product.id]} alt="" width={32} height={32} />
                <span className="min-w-0 flex-1"><strong className="block truncate text-sm font-semibold">{product.name}</strong><span className="block truncate text-xs text-muted-foreground">{toolFacts(product.id, { attention, facts, statuses, operational, total: monitorIds.size, now, monitorId: product.monitorId })}</span></span>
                {product.external ? <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />}
              </span>
            </>;
            const className = "block min-w-0 border-b border-border/60 px-1 py-3 transition-colors hover:bg-accent";
            return product.external
              ? <a key={product.id} className={className} href={product.href} target="_blank" rel="noreferrer">{card}</a>
              : product.id === "markdown-share"
                ? <Link key={product.id} className={className} to="/documents" preload="intent">{card}</Link>
                : <Link key={product.id} className={className} to={product.href as "/feedback" | "/publisher" | "/money" | "/status"} preload="intent">{card}</Link>;
          })}
        </div></section>

        {infrastructure.length > 0 ? (
          <details className="rounded-xl bg-card ring-1 ring-[color:var(--surface-border)]" aria-labelledby="infrastructure-title">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 marker:hidden"><ChevronRight className="size-4 transition-transform [[open]>&]:rotate-90" aria-hidden="true" /><h2 id="infrastructure-title" className="text-sm font-semibold">Infrastructure</h2><span className="text-xs text-muted-foreground">{operational} of {monitorIds.size} checks passing</span></summary>
            <ul className="grid gap-x-6 px-4 pb-2 pt-1 md:grid-cols-2" role="list">
              {infrastructure.map((product) => {
                const status = product.monitorId ? statuses[product.monitorId] : undefined;
                return <li key={product.id} className="border-t border-border/60">
                  <a className="group flex min-w-0 items-center gap-3 py-2.5" href={product.href} target="_blank" rel="noreferrer">
                    <span className={`size-2 shrink-0 rounded-full ${status?.status === "up" ? "bg-positive" : status?.status === "down" ? "bg-negative" : "bg-muted-foreground"}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1"><strong className="block truncate text-sm font-medium">{product.name}</strong><span className="block truncate text-xs text-muted-foreground">{product.description}</span></span>
                    <span className={`shrink-0 text-xs ${status?.status === "down" ? "text-negative" : "text-muted-foreground"}`}>{infrastructureStatus(status)}{status?.latencyMs ? ` · ${status.latencyMs} ms` : ""}</span>
                    <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
                  </a>
                </li>;
              })}
            </ul>
          </details>
        ) : null}
      </div>
    </main>
  </>;
}

function needsItems(attention: AttentionSummary, now: number): NeedsItem[] {
  const items: NeedsItem[] = [];
  const open = (label: string, link: ReactElement) => <Button nativeButton={false} variant="outline" size="sm" render={link}>{label}</Button>;
  for (const service of attention.servicesDown ?? []) {
    items.push({ key: `status:${service.name}`, icon: favicons.status, tool: "Status", text: `${service.name} is down${service.since ? ` since ${clockFormatter.format(new Date(service.since))}` : ""}`, link: open("View incident", <Link to="/status" hash="incidents" preload="intent" />), urgent: true });
  }
  for (const document of (attention.documentsExpiring ?? []).slice(0, 3)) {
    items.push({ key: `document:${document.filename}`, icon: favicons.markdownShare, tool: "Markdown Share", text: `${document.filename} expires in ${timeLeft(document.expiresAt - now)}`, link: open("Review document", <Link to="/documents" preload="intent" />), urgent: true });
  }
  if (attention.moneyReview) items.push({ key: "money", icon: favicons.money, tool: "Money", text: `${countLabel(attention.moneyReview, "row")} need${attention.moneyReview === 1 ? "s" : ""} review before the totals are exact`, link: open("Review", <Link to="/money" search={{ view: "review" }} preload="intent" />), urgent: false });
  if (attention.feedbackUnread) items.push({ key: "feedback", icon: favicons.feedback, tool: "Feedback", text: countLabel(attention.feedbackUnread, "unread response"), link: open("Read", <Link to="/feedback" preload="intent" />), urgent: false });
  return items;
}

function toolFacts(id: ProductId, input: { attention: AttentionSummary; facts: DashboardData["facts"]; statuses: Record<string, PublicMonitorStatus>; operational: number; total: number; now: number; monitorId?: string }): ReactNode {
  const { attention, facts } = input;
  const strong = (value: ReactNode, tone = "") => <strong className={`font-semibold tabular-nums ${tone || "text-foreground"}`}>{value}</strong>;
  switch (id) {
    case "publisher":
      return facts.artifacts === undefined ? <span>Publish plans and files</span> : <span>{strong(facts.artifacts.toLocaleString("en-GB"))} artifacts</span>;
    case "money":
      return attention.moneyReview === undefined ? <span>Accounts, spending and plans</span> : attention.moneyReview ? <span>{strong(attention.moneyReview, "text-warning")} to review</span> : <span>Nothing to review</span>;
    case "feedback":
      return <>{facts.activeForms === undefined ? null : <span>{strong(facts.activeForms)} open {facts.activeForms === 1 ? "form" : "forms"}</span>}{attention.feedbackUnread === undefined ? null : <span>{strong(attention.feedbackUnread)} unread</span>}</>;
    case "status":
      return <span>{strong(`${input.operational} of ${input.total}`)} operational</span>;
    case "markdown-share":
      return facts.documents === undefined ? <span>Share rendered Markdown</span> : <><span>{strong(`${facts.documents}${facts.documentsTruncated ? "+" : ""}`)} {facts.documents === 1 ? "document" : "documents"}</span>{facts.nextDocumentExpiry ? <span>next expiry {strong(timeLeft(facts.nextDocumentExpiry - input.now))}</span> : null}</>;
    case "network-console": {
      const status = input.monitorId ? input.statuses[input.monitorId] : undefined;
      return <><span>Tailnet only</span><span className={status?.status === "up" ? "text-positive" : status?.status === "down" ? "text-negative" : ""}>{infrastructureStatus(status)}</span></>;
    }
  }
}

export function timeLeft(ms: number) {
  const hours = Math.max(1, Math.ceil(ms / 3_600_000));
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

function catalogProducts(snapshot: Snapshot): CatalogProduct[] {
  if (!("catalog" in snapshot)) return [];
  const standardMonitorIds = new Set<string>(products.flatMap(({ monitorId }) => monitorId ? [monitorId] : []));
  return snapshot.catalog.entries
    .filter((entry) => entry.lifecycle === "active" && entry.monitor?.enabled && !standardMonitorIds.has(entry.id))
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const link = preferredCatalogLink(entry);
      return link ? [{ id: `catalog:${entry.id}`, name: entry.name, description: entry.description, href: link.url, monitorId: entry.id }] : [];
    });
}

function preferredCatalogLink(entry: CatalogEntry) {
  return entry.links.find(({ access }) => access === "private") ?? entry.links.find(({ access }) => access === "restricted") ?? entry.links[0];
}

function statusMap(snapshot: Snapshot): Record<string, PublicMonitorStatus> {
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

function infrastructureStatus(status: PublicMonitorStatus | undefined) {
  if (status?.status === "up") return "Operational";
  if (status?.status === "down") return "Unavailable";
  if (status?.status === "paused") return "Paused";
  if (status?.status === "checking") return "Checking";
  return "Not monitored";
}
