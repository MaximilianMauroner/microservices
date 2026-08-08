import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PrivateSnapshotDocument, PublicSnapshotDocument } from "@tools-platform/domain";
import { ToolsDirectory } from "../src/features/catalog/tools-directory.js";
import { PrivateToolsStatus, ToolsStatus } from "../src/features/status/tools-status.js";

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
          url: "https://mm-tools.cloudflareaccess.com/cdn-cgi/access/login/tools.mauroner.net?redirect_url=%2Fpublish",
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
        monitor: { enabled: true, paused: false, scope: "tailscale", url: "https://private.example.test/health" }
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
  it("renders the directory with shadcn-style primitives and local links", () => {
    const html = renderToStaticMarkup(
      <ToolsDirectory snapshot={snapshot} publicOrigin="https://tools.mauroner.net" />
    );

    expect(html).toContain('data-slot="card"');
    expect(html).toContain('data-slot="badge"');
    expect(html).toContain('data-variant="default"');
    expect(html).toContain('href="#catalog"');
    expect(html).toContain("Browse tools");
    expect(html).toContain('href="/publish"');
    expect(html).not.toContain('href="https://tools.mauroner.net/publish"');
  });

  it("renders status semantics and the rolling availability window", () => {
    const html = renderToStaticMarkup(
      <ToolsStatus snapshot={snapshot} publicOrigin="https://tools.mauroner.net" />
    );

    expect(html).toContain("All monitored services operational");
    expect(html).toContain('aria-label="Observed uptime: 100% across 1 checks; 1 recorded days and 89 no-data days."');
    expect(html).toContain('class="uptime-bar-scroll"');
    expect(html).toContain("uptime-scroll-hint");
    expect(html).toContain("private-status-link");
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
});
