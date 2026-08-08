import type {
  MonitorStatus,
  PublicCatalogEntry,
  PublicMonitorStatus,
  PublicSnapshotDocument
} from "@tools-platform/domain";
import { Link } from "@tanstack/react-router";
import { AppShell } from "../../components/app-shell.js";
import { LocalTimestamp } from "../../components/local-time.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardHeader } from "../../components/ui/card.js";

const iconPaths: Readonly<Record<string, string>> = {
  "artifact-publisher": "/assets/icons/artifact-publisher.png",
  "field-guide-console": "/assets/icons/field-guide-console.png",
  "tools-directory": "/assets/icons/tools-status-directory.png",
  "network-console": "/assets/icons/network-console.png"
};

const statusLabels: Record<MonitorStatus, string> = {
  checking: "Checking",
  up: "Operational",
  down: "Unavailable",
  paused: "Monitoring paused",
  unavailable: "Not checkable from Railway"
};

export function ToolsDirectory({
  snapshot,
  publicOrigin
}: {
  snapshot: PublicSnapshotDocument;
  publicOrigin: string;
}) {
  const groups = [...snapshot.groups].sort(byOrderThenId);
  const entries = [...snapshot.entries].sort(byOrderThenId);

  return (
    <>
      <AppShell active="tools" showSignOut />
      <main id="main">
        <section className="mx-auto w-[min(1180px,calc(100%_-_2rem))] py-16 sm:py-24" aria-labelledby="tools-title">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Useful, focused services</p>
          <h1 id="tools-title" className="mt-4 max-w-4xl text-4xl font-semibold tracking-[-0.04em] sm:text-6xl lg:text-7xl">Tools for publishing, review, and operations.</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            A curated directory of Mauroner services, with clear access requirements and live availability.
          </p>
          <Button variant="default" className="mt-6" render={<a href="#catalog" />}>
            Browse tools <span aria-hidden="true">↓</span>
          </Button>
          <p className="mt-5 font-mono text-xs text-muted-foreground">
            Catalog updated <LocalTimestamp value={snapshot.generatedAt} fallback={formatTimestamp(snapshot.generatedAt)} />
          </p>
        </section>
        <section id="catalog" className="mx-auto grid w-[min(1180px,calc(100%_-_2rem))] gap-x-10 pb-20 lg:grid-cols-2" aria-label="Tool directory">
          {groups.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 lg:col-span-2">
              <h2 className="font-semibold">No tools published yet</h2>
              <p className="mt-2 text-sm text-muted-foreground">The public catalog is ready for its first entry.</p>
            </div>
          ) : groups.map((group, index) => {
            const groupEntries = entries.filter((entry) => entry.groupId === group.id);
            if (groupEntries.length === 0) return null;
            return (
              <section key={group.id} className="border-t py-8 sm:py-10" aria-labelledby={`group-${group.id}`}>
                <header className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3 sm:grid-cols-[4rem_minmax(0,1fr)]">
                  <p className="pt-1 font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</p>
                  <div>
                    <h2 id={`group-${group.id}`} className="text-xl font-semibold tracking-tight sm:text-2xl">{group.name}</h2>
                    {group.description ? <p className="mt-2 text-sm text-muted-foreground">{group.description}</p> : null}
                  </div>
                </header>
                <ul className="mt-5 grid list-none gap-3 pl-0 sm:ml-16" role="list">
                  {groupEntries.map((entry) => (
                    <ToolCard
                      key={entry.id}
                      entry={entry}
                      status={snapshot.statuses[entry.id]}
                      publicOrigin={publicOrigin}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
          <section className="border-t py-8 sm:py-10" aria-labelledby="private-tools-title">
            <header className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3 sm:grid-cols-[4rem_minmax(0,1fr)]">
              <p className="pt-1 font-mono text-xs text-muted-foreground">{String(groups.length + 1).padStart(2, "0")}</p>
              <div><h2 id="private-tools-title" className="text-xl font-semibold tracking-tight sm:text-2xl">Private</h2><p className="mt-2 text-sm text-muted-foreground">Personal tools protected by your Google session.</p></div>
            </header>
            <ul className="mt-5 grid list-none gap-3 pl-0 sm:ml-16" role="list">
              <li><Card className="gap-4 border-input bg-card p-5 sm:p-6"><CardHeader className="items-start"><div><p className="mb-2 flex items-center gap-1.5 font-mono text-[0.65rem] font-semibold uppercase tracking-wide text-sky-400"><span className="suite-lock" aria-hidden="true" />Google session</p><h3 className="text-lg font-semibold">Money tracker</h3></div><Badge variant="outline">Private</Badge></CardHeader><p className="text-sm leading-6 text-muted-foreground">Track cash, stocks, account changes, and monthly net worth from Google Sheets.</p><div><Button variant="outline" render={<Link to="/tools/private/money" preload="intent" />}>Open money tracker <span aria-hidden="true">›</span></Button></div></Card></li>
            </ul>
          </section>
        </section>
      </main>
      <footer className="border-t">
        <div className="mx-auto w-[min(1180px,calc(100%_-_2rem))] py-6 font-mono text-xs text-muted-foreground">Mauroner Tools · Availability updates every five minutes</div>
      </footer>
    </>
  );
}

function ToolCard({
  entry,
  status,
  publicOrigin
}: {
  entry: PublicCatalogEntry;
  status: PublicMonitorStatus | undefined;
  publicOrigin: string;
}) {
  const accessLabels = entry.id === "network-console"
    ? ["Tailscale required"]
    : [
        ...(entry.links.some((link) => link.access === "public") ? ["Public"] : []),
        ...(entry.links.some((link) => link.access === "restricted") ? ["Sign-in required"] : [])
      ];
  if (accessLabels.length === 0) accessLabels.push("Public");
  const accessClass = entry.id === "network-console"
    ? "text-amber-400"
    : accessLabels.includes("Public")
      ? "text-emerald-400"
      : "text-sky-400";
  const iconPath = iconPaths[entry.id];
  const links = entry.links.flatMap((link) => {
    const destination = safeHttpUrl(link.url);
    return destination ? [{ ...link, destination }] : [];
  });

  return (
    <li>
      <Card className="gap-4 border-input bg-card p-5 sm:p-6">
        <CardHeader className="items-start">
          <div className="flex min-w-0 items-start gap-3">
            {iconPath ? <img className="size-11 shrink-0 rounded-md" src={iconPath} alt="" width="48" height="48" /> : null}
            <div className="min-w-0">
              <p className={`mb-2 flex items-center gap-1.5 font-mono text-[0.65rem] font-semibold uppercase tracking-wide ${accessClass}`}>
                {accessLabels.includes("Sign-in required") ? <span className="suite-lock" aria-hidden="true" /> : null}
                {accessLabels.join(" · ")}
              </p>
              <h3 className="text-lg font-semibold">{entry.name}</h3>
            </div>
          </div>
          <StatusBadge status={status} />
        </CardHeader>
        <p className="text-sm leading-6 text-muted-foreground">{entry.description}</p>
        <p className="font-mono text-xs text-muted-foreground">{statusDetails(status)}</p>
        {links.length > 0 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label={`${entry.name} links`}>
            {links.map((link) => (
              <DirectoryLink
                key={link.id}
                href={link.destination}
                label={link.label}
                publicOrigin={publicOrigin}
              />
            ))}
          </div>
        ) : <p className="text-xs text-muted-foreground">No browser entry point is published.</p>}
      </Card>
    </li>
  );
}

function DirectoryLink({ href, label, publicOrigin }: { href: string; label: string; publicOrigin: string }) {
  const resolvedHref = resolveBrowserLink(href, publicOrigin);
  const sameOrigin = resolvedHref !== href;
  return (
    <Button
      variant="outline"
      render={sameOrigin ? <Link to={resolvedHref} preload="intent" /> : <a href={resolvedHref} target="_blank" rel="noreferrer" />}
    >
      <span>{label}</span>
      <span aria-hidden="true">{sameOrigin ? "›" : "↗"}</span>
      {sameOrigin ? null : <span className="visually-hidden"> (opens in a new tab)</span>}
    </Button>
  );
}

export function resolveBrowserLink(href: string, publicOrigin: string) {
  const destination = new URL(href);
  if (destination.origin === new URL(publicOrigin).origin) {
    return `${destination.pathname}${destination.search}${destination.hash}`;
  }
  return href;
}

export function StatusBadge({ status }: { status: PublicMonitorStatus | undefined }) {
  const variant = status?.status === "down"
    ? "destructive"
    : status?.status === "up"
      ? "default"
      : status?.status === "checking"
        ? "secondary"
        : "outline";
  return (
    <Badge variant={variant}>
      {status ? statusLabels[status.status] : "Not monitored"}
    </Badge>
  );
}

export function statusDetails(status: PublicMonitorStatus | undefined) {
  if (!status) return "No automated checks";
  if (status.status === "unavailable") return "This private target cannot be reached by the Railway checker.";
  if (status.status === "paused") return "Automated checks are paused.";
  if (!status.checkedAt) return "Waiting for the first check.";
  const metrics = [
    status.latencyMs === null ? null : `${status.latencyMs} ms`,
    status.statusCode === null ? null : `HTTP ${status.statusCode}`
  ].filter((value): value is string => value !== null);
  return `Checked ${formatTimestamp(status.checkedAt)}${metrics.length > 0 ? ` · ${metrics.join(" · ")}` : ""}`;
}

export function formatTimestamp(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(timestamp) + " UTC";
}

function byOrderThenId<T extends { id: string; order: number }>(left: T, right: T) {
  return left.order - right.order || left.id.localeCompare(right.id);
}

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
