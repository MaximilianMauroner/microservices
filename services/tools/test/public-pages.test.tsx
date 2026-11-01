import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PrivateSnapshotDocument, PublicSnapshotDocument } from "@tools-platform/domain";
import { ToolsDirectory } from "../dashboard/ui/tools-directory.js";
import { PrivateToolsStatus, ToolsStatus } from "../status/ui/tools-status.js";

const snapshot: PublicSnapshotDocument = {
  schemaVersion: 1,
  generatedAt: "2026-08-04T06:05:00.000Z",
  catalogRevision: "revision-1",
  groups: [
    { id: "publishing", name: "Publishing & sharing", order: 0 }
  ],
  entries: [
    {
      id: "artifact-publisher",
      groupId: "publishing",
      name: "Artifact Publisher",
      description: "Publish durable artifacts.",
      order: 0,
      links: [
        {
          id: "publish",
          label: "Open uploader",
          url: "https://tools.mauroner.net/publisher",
          access: "restricted"
        }
      ]
    }
  ],
  statuses: {
    "artifact-publisher": {
      monitorId: "artifact-publisher",
      status: "up",
      checkedAt: "2026-08-04T06:04:00.000Z",
      latencyMs: 42,
      statusCode: 200,
      uptimeDays: [
        { day: "2026-08-04", successfulChecks: 1, totalChecks: 1 }
      ],
      downtimeRecords: []
    }
  }
};

const privateSnapshot: PrivateSnapshotDocument = {
  schemaVersion: 1,
  generatedAt: snapshot.generatedAt,
  catalogRevision: snapshot.catalogRevision,
  catalog: {
    schemaVersion: 1,
    revision: snapshot.catalogRevision,
    updatedAt: snapshot.generatedAt,
    groups: [
      { id: "private-ops", name: "Private operations", order: 0, visibility: "private" },
      { id: "public-tools", name: "Public tools", order: 1, visibility: "public" }
    ],
    entries: [
      {
        id: "private-console",
        groupId: "private-ops",
        name: "Private console",
        description: "Internal operations console.",
        order: 0,
        visibility: "private",
        lifecycle: "active",
        links: [{ id: "console", label: "Open console", url: "https://private.example.test", access: "private" }],
        monitor: { tracking: "http", enabled: true, paused: false, scope: "tailscale", url: "https://private.example.test/health" }
      },
      {
        id: "public-console",
        groupId: "public-tools",
        name: "Public console",
        description: "Public operations console.",
        order: 0,
        visibility: "public",
        lifecycle: "active",
        links: [{ id: "console", label: "Open console", url: "https://public.example.test", access: "public" }]
      }
    ]
  },
  state: {
    schemaVersion: 2,
    revision: "state-1",
    updatedAt: snapshot.generatedAt,
    lastRunId: null,
    monitors: {},
    incidents: [],
    notifications: [],
    historyPending: []
  }
};

function service(id: string, name: string, order: number): PublicSnapshotDocument["entries"][number] {
  return { id, groupId: "publishing", name, description: `${name} service.`, order, links: [] };
}

const outageSnapshot: PublicSnapshotDocument = {
  ...snapshot,
  entries: [service("home-assistant", "Home Assistant", 0), service("tools", "Tools", 1), service("tower", "Tower", 2), service("markdown", "Markdown Share", 3)],
  statuses: {
    "home-assistant": {
      monitorId: "home-assistant",
      status: "down",
      checkedAt: "2026-08-04T06:04:00.000Z",
      latencyMs: null,
      statusCode: null,
      uptimeDays: [{ day: "2026-08-04", successfulChecks: 0, totalChecks: 2 }],
      downtimeRecords: [
        { startedAt: "2026-08-04T05:23:00.000Z", resolvedAt: null },
        { startedAt: "2026-07-25T10:00:00.000Z", resolvedAt: "2026-07-25T10:48:00.000Z" },
        { startedAt: "2026-06-25T03:00:00.000Z", resolvedAt: "2026-06-25T03:31:00.000Z" }
      ]
    },
    tools: { monitorId: "tools", status: "up", checkedAt: "2026-08-04T06:04:00.000Z", latencyMs: 40, statusCode: 200, uptimeDays: [{ day: "2026-08-04", successfulChecks: 98, totalChecks: 98 }], downtimeRecords: [] },
    tower: { monitorId: "tower", status: "up", checkedAt: "2026-08-04T06:04:00.000Z", latencyMs: 100, statusCode: 200, downtimeRecords: [] },
    markdown: { monitorId: "markdown", status: "up", checkedAt: "2026-08-04T06:04:00.000Z", latencyMs: 60, statusCode: 200, downtimeRecords: [] }
  }
};

/** The value shown under one summary label. */
function stat(html: string, label: string) {
  return html.match(new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*>([^<]*)</dd>`))?.[1];
}

describe("TanStack Start public pages", () => {
  it("renders the Orbit product dashboard from typed product definitions", () => {
    const html = renderToStaticMarkup(
      <ToolsDirectory snapshot={snapshot} publicOrigin="https://tools.mauroner.net" />
    );

    expect(html).toContain('data-suite-shell="orbit"');
    expect(html).toMatch(/<\/svg>Private<\/span>/);
    expect(html).toMatch(/<\/svg>Not monitored<\/span>/);
    expect(html).toContain('title="From the shared Tools health check"');
    expect(html).toContain("1 of 4 health checks passing");
    expect(html).toContain("Useful things,");
    expect(html).toContain("xl:grid-cols-4");
    expect(html).toContain("Publisher");
    expect(html).toContain("Markdown Share");
    expect(html).toContain("bg-violet-300");
    expect(html).toContain("bg-lime-300");
    expect(html).toContain("bg-cyan-300");
    expect(html).toContain("bg-rose-300");
    expect(html).toContain("bg-blue-300");
    expect(html).toContain('href="/markdown"');
    expect(html).toContain('href="/money"');
    expect(html).toContain('href="/publisher"');
    expect(html).toContain('href="/status"');
    expect(html.indexOf("Publisher")).toBeLessThan(html.indexOf("Feedback"));
    expect(html.indexOf("Money")).toBeLessThan(html.indexOf("Feedback"));
    expect(html.indexOf("Feedback")).toBeLessThan(html.indexOf("Status"));
    for (const product of ["publisher", "money", "status", "markdown-share", "network-console"]) {
      expect(html).toContain(`/assets/icons/${product}.png`);
    }
  });

  it("adds monitored non-standard products from the authenticated catalog", () => {
    const html = renderToStaticMarkup(
      <ToolsDirectory snapshot={privateSnapshot} publicOrigin="https://tools.mauroner.net" />
    );

    expect(html).toContain("Private console");
    expect(html).toContain('href="https://private.example.test"');
    expect(html).toContain('id="infrastructure-title"');
    expect(html).toContain("Infrastructure");
    expect(html).not.toContain("Public console");
    expect(html).toContain("Publisher");
    expect(html).toContain("0 of 5 health checks passing");
  });

  it("renders status semantics and the rolling availability window", () => {
    const html = renderToStaticMarkup(
      <ToolsStatus snapshot={snapshot} publicOrigin="https://tools.mauroner.net" />
    );

    expect(html).toContain("All services operational");
    expect(html).toContain("Checked every 30 minutes · last check");
    expect(html).toContain('aria-label="Observed uptime: 100% across 1 check; 1 recorded day and 89 no-data days."');
    expect(html.match(/title="\d{1,2} \w{3} \d{4} · /g)).toHaveLength(90);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Private service status");
    expect(html).toContain('data-suite-accent="cyan"');
    expect(html).not.toContain("System status");
  });

  it("names the down service and summarizes uptime, incidents and latency", () => {
    const html = renderToStaticMarkup(<ToolsStatus snapshot={outageSnapshot} publicOrigin="https://tools.mauroner.net" />);

    expect(html).toContain("1 service is down");
    expect(html).toMatch(/Home Assistant has not answered since <time [^>]*"2026-08-04T05:23:00.000Z">[^<]+<\/time>\. The other 3 services are operational\./);
    expect(html).toContain("Down 42 min");
    expect(stat(html, "Operational")).toBe("3 of 4");
    // 98 of 100 checks passed across services, not the 50% mean of per-service percentages.
    expect(stat(html, "Uptime, 90 days")).toBe("98%");
    // The record from 40 days ago is outside the window; the ongoing one counts.
    expect(stat(html, "Incidents, 30 days")).toBe("2");
    expect(stat(html, "Median latency")).toBe("60 ms");
  });

  it("lists every down service when more than one is down", () => {
    const tower = outageSnapshot.statuses.tower;
    if (!tower) throw new Error("fixture needs tower");
    const html = renderToStaticMarkup(<ToolsStatus snapshot={{ ...outageSnapshot, statuses: { ...outageSnapshot.statuses, tower: { ...tower, status: "down", latencyMs: null } } }} publicOrigin="https://tools.mauroner.net" />);

    expect(html).toContain("2 services are down");
    expect(html).toMatch(/Not answering: Home Assistant since <time[^>]*>[^<]+<\/time>, Tower since <time/);
    expect(html).toContain("The other 2 services are operational.");
  });

  it("renders the private status view from the same status surface", () => {
    const html = renderToStaticMarkup(
      <PrivateToolsStatus snapshot={privateSnapshot} actor="operator@example.test" publicOrigin="https://tools.mauroner.net" />
    );

    expect(html).toContain("Signed in as operator@example.test");
    expect(html).toContain("Private console");
    expect(html).not.toContain("Public console");
    expect(html).toContain('href="/status"');
  });

  it("includes public and private services in the authenticated status view", () => {
    const html = renderToStaticMarkup(
      <ToolsStatus snapshot={privateSnapshot} publicOrigin="https://tools.mauroner.net" />
    );

    expect(html).toContain("Private console");
    expect(html).toContain("Public console");
    expect(html).not.toContain("Private service status");
  });
});
