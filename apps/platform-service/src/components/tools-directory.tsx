import type {
  MonitorStatus,
  PublicCatalogEntry,
  PublicMonitorStatus,
  PublicSnapshotDocument
} from "@tools-platform/domain";
import { AppShell } from "./app-shell.js";
import { LocalTimestamp } from "./local-time.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { Card, CardHeader } from "./ui/card.js";

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
      <AppShell active="tools" />
      <main id="main" className="tools-home">
        <section className="tools-intro wrap" aria-labelledby="tools-title">
          <p className="eyebrow">Useful, focused services</p>
          <h1 id="tools-title">Tools for publishing, review, and operations.</h1>
          <p className="lede">
            A curated directory of Mauroner services, with clear access requirements and live availability.
          </p>
          <Button variant="default" render={<a href="#catalog" />}>
            Browse tools <span aria-hidden="true">↓</span>
          </Button>
          <p className="freshness">
            Catalog updated <LocalTimestamp value={snapshot.generatedAt} fallback={formatTimestamp(snapshot.generatedAt)} />
          </p>
        </section>
        <section id="catalog" className="catalog wrap" aria-label="Tool directory">
          {groups.length === 0 ? (
            <div className="empty-state">
              <h2>No tools published yet</h2>
              <p>The public catalog is ready for its first entry.</p>
            </div>
          ) : groups.map((group, index) => {
            const groupEntries = entries.filter((entry) => entry.groupId === group.id);
            if (groupEntries.length === 0) return null;
            return (
              <section key={group.id} className="catalog-group" aria-labelledby={`group-${group.id}`}>
                <header className="group-header">
                  <p className="group-index">{String(index + 1).padStart(2, "0")}</p>
                  <div>
                    <h2 id={`group-${group.id}`}>{group.name}</h2>
                    {group.description ? <p>{group.description}</p> : null}
                  </div>
                </header>
                <ul className="tool-grid" role="list">
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
        </section>
      </main>
      <footer className="site-footer">
        <div className="wrap">Mauroner Tools · Availability updates every five minutes</div>
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
        ...(entry.links.some((link) => link.access === "restricted") ? ["Cloudflare Access"] : [])
      ];
  if (accessLabels.length === 0) accessLabels.push("Public");
  const accessClass = entry.id === "network-console"
    ? "tailscale"
    : accessLabels.includes("Public")
      ? "public"
      : "access";
  const iconPath = iconPaths[entry.id];
  const links = entry.links.flatMap((link) => {
    const destination = safeHttpUrl(link.url);
    return destination ? [{ ...link, destination }] : [];
  });

  return (
    <li>
      <Card className="tool-card">
        <CardHeader>
          <div className="tool-card__identity">
            {iconPath ? <img className="tool-card__icon" src={iconPath} alt="" width="48" height="48" /> : null}
            <div>
              <p className={`access-label access-label--${accessClass}`}>
                {accessLabels.includes("Cloudflare Access") ? <span className="suite-lock" aria-hidden="true" /> : null}
                {accessLabels.join(" · ")}
              </p>
              <h3>{entry.name}</h3>
            </div>
          </div>
          <StatusBadge status={status} />
        </CardHeader>
        <p>{entry.description}</p>
        <p className="status-detail">{statusDetails(status)}</p>
        {links.length > 0 ? (
          <div className="tool-links" role="group" aria-label={`${entry.name} links`}>
            {links.map((link) => (
              <DirectoryLink
                key={link.id}
                href={link.destination}
                label={link.label}
                publicOrigin={publicOrigin}
              />
            ))}
          </div>
        ) : <p className="no-link">No browser entry point is published.</p>}
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
      render={<a href={resolvedHref} {...(sameOrigin ? {} : { target: "_blank", rel: "noreferrer" })} />}
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
  if (destination.pathname.startsWith("/cdn-cgi/access/login/")) {
    const redirect = destination.searchParams.get("redirect_url");
    if (redirect?.startsWith("/") && !redirect.startsWith("//")) return redirect;
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
