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

describe("TanStack Start public pages", () => {
  it("renders the dashboard tools in product order with their links", () => {
    const html = renderToStaticMarkup(
      <ToolsDirectory snapshot={snapshot} publicOrigin="https://tools.mauroner.net" />
    );

    expect(html).toContain('data-suite-shell="orbit"');
    expect(html).toContain("3 checks need attention");
    expect(html).toContain("Nothing needs you right now.");
    expect(html).not.toContain("Useful things,");
    for (const href of ["/publisher", "/money", "/feedback", "/status", "/documents"]) expect(html).toContain(`href="${href}"`);
    expect(html.indexOf("Publisher")).toBeLessThan(html.indexOf("Feedback"));
    expect(html.indexOf("Money")).toBeLessThan(html.indexOf("Feedback"));
    expect(html.indexOf("Feedback")).toBeLessThan(html.indexOf(">Status<"));
    for (const product of ["publisher", "money", "status", "markdown-share", "network-console"]) {
      expect(html).toContain(`/assets/icons/${product}.png`);
    }
  });

  it("lists the work that needs the owner, without expiring files", () => {
    const generatedAt = new Date(snapshot.generatedAt).getTime();
    const html = renderToStaticMarkup(
      <ToolsDirectory
        snapshot={snapshot}
        publicOrigin="https://tools.mauroner.net"
        attention={{ moneyReview: 7, feedbackUnread: 1, servicesDown: [{ name: "Home Assistant", since: null }], documentsExpiring: [{ filename: "notes.md", expiresAt: generatedAt + 3_600_000 }] }}
        facts={{ artifacts: 142, activeForms: 2 }}
      />
    ).replaceAll("&quot;", '"');

    expect(html).toContain("7 rows need review before the totals are exact");
    expect(html).toContain('href="/money?view=review"');
    expect(html).toContain("1 unread response");
    expect(html).toContain("Home Assistant is down");
    expect(html).toContain("notes.md expires in 1 h");
    expect(html).toContain("4 things need you");
    expect(html).not.toMatch(/files? expire/);
    expect(html).toMatch(/142<\/strong> artifacts/);
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
    expect(html).toContain("5 checks need attention");
  });

  it("renders status semantics and the rolling availability window", () => {
    const html = renderToStaticMarkup(
      <ToolsStatus snapshot={snapshot} publicOrigin="https://tools.mauroner.net" />
    );

    expect(html).toContain("All monitored services operational");
    expect(html).toContain('aria-label="Observed uptime: 100% across 1 check; 1 recorded day and 89 no-data days."');
    expect(html).toContain('class="uptime-bar-scroll"');
    expect(html).toContain("private-status-link");
    expect(html).toContain('data-suite-accent="cyan"');
    expect(html).toContain("Checked every 30 minutes");
    expect(html).not.toContain("Five-minute checks");
    expect(html.match(/class="uptime-day /g)).toHaveLength(90);
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
    expect(html).not.toContain("private-status-callout");
  });
});
