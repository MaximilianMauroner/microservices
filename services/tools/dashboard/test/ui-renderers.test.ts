import { describe, expect, test } from "vitest";
import type {
  PrivateSnapshotDocument,
  PublicSnapshotDocument
} from "@tools-platform/domain";
import {
  renderOperationsAuditPage,
  renderOperationsHistoryPage,
  renderOperationsPage,
  renderPrivateStatusPage,
  renderPublicPage,
  renderStatusPage
} from "../src/ui/index.js";

const generatedAt = "2026-07-27T12:00:00.000Z";

const publicSnapshot: PublicSnapshotDocument = {
  schemaVersion: 1,
  generatedAt,
  catalogRevision: "revision-1",
  groups: [
    {
      id: "publishing",
      name: "Publishing & sharing",
      description: "Useful output",
      order: 0
    }
  ],
  entries: [
    {
      id: "artifact-publisher",
      groupId: "publishing",
      name: 'Artifact <Publisher>',
      description: 'Uploads "things" safely',
      order: 0,
      links: [
        {
          id: "public",
          label: "Open",
          url: "https://uploads.example.test/path?a=1&b=2",
          access: "public"
        },
        {
          id: "restricted",
          label: "Admin",
          url: "https://admin.example.test",
          access: "restricted"
        }
      ]
    },
    {
      id: "network-console",
      groupId: "publishing",
      name: "Network console",
      description: "Tailnet-only orientation",
      order: 1,
      links: []
    }
  ],
  statuses: {
    "artifact-publisher": {
      monitorId: "artifact-publisher",
      status: "up",
      checkedAt: generatedAt,
      latencyMs: 42,
      statusCode: 200,
      uptimeDays: [
        {
          day: "2026-07-27",
          successfulChecks: 98,
          totalChecks: 100
        }
      ]
    },
    "network-console": {
      monitorId: "network-console",
      status: "unavailable",
      checkedAt: null,
      latencyMs: null,
      statusCode: null
    }
  }
};

const privateSnapshot: PrivateSnapshotDocument = {
  schemaVersion: 1,
  generatedAt,
  catalogRevision: "revision-1",
  catalog: {
    schemaVersion: 1,
    revision: "revision-1",
    updatedAt: generatedAt,
    groups: [
      {
        id: "ops",
        name: "Operations",
        order: 0,
        visibility: "private"
      }
    ],
    entries: [
      {
        id: "secret",
        groupId: "ops",
        name: "Port service",
        description: "Private tool",
        order: 0,
        visibility: "private",
        lifecycle: "active",
        links: [
          {
            id: "tailnet",
            label: "Tailnet",
            url: "https://private.example.test",
            access: "private"
          }
        ],
        monitor: {
          tracking: "http",
          enabled: true,
          paused: false,
          scope: "tailscale",
          url: "https://private.example.test/health"
        },
        privateNotes: '</textarea><script>alert("secret")</script>'
      }
    ]
  },
  state: {
    schemaVersion: 2,
    revision: "state-1",
    updatedAt: generatedAt,
    lastRunId: "run-1",
    monitors: {},
    incidents: [],
    notifications: [
      {
        id: "notification-secret",
        incidentId: "incident-secret",
        kind: "down",
        displayName: "Private console",
        status: "pending",
        attempts: 1,
        nextAttemptAt: null,
        deliveredAt: null,
        lastErrorCode: "raw-discord-error",
        claimToken: null,
        claimedUntil: null
      }
    ],
    historyPending: []
  }
};

describe("public page", () => {
  test("renders a categorized Tools directory with access and availability labels", () => {
    const html = renderPublicPage(publicSnapshot);

    expect(html).toContain('<main id="main"');
    expect(html).toContain('<link rel="canonical" href="https://tools.mauroner.net/">');
    expect(html).toContain('property="og:type" content="website"');
    expect(html).toContain('href="#catalog">Browse tools');
    expect(html).toContain('class="browse-tools directory-primary-action"');
    expect(html).toContain('aria-current="page">Tools');
    expect(html).toContain("Publishing &amp; sharing");
    expect(html).toContain("Sign-in required");
    expect(html).toContain("Tailscale required");
    expect(html).toContain("Operational");
    expect(html).toContain("Unavailable from Railway");
    expect(html).toContain('<meta name="theme-color" content="#000000">');
    expect(html).toContain('<header class="suite-header" data-suite-shell="command-deck">');
    expect(html).not.toContain("Operator sign-in");
    expect(html).toContain('<link rel="icon" href="/favicon.svg?v=90e2a71" type="image/svg+xml">');
    expect(html).toContain('<link rel="stylesheet" href="/assets/tools.css?v=be38fb8a48fb">');
    expect(html).toContain('src="/assets/icons/artifact-publisher.png"');
    expect(html).toContain('src="/assets/icons/network-console.png"');
    expect(html).not.toContain('<script src="/assets/ops.js"');
  });

  test("renders the status summary, exact history bars, and labeled restricted links", () => {
    const html = renderStatusPage(publicSnapshot);

    expect(html).toContain('<main id="main"');
    expect(html).toContain('aria-labelledby="status-title"');
    expect(html).toContain('aria-labelledby="services-title"');
    expect(html).toContain('role="list"');
    expect(html).toContain("All monitored services operational");
    expect(html).toContain("1 service not measured");
    expect(html).toContain("Operational");
    expect(html).toContain("Not checkable from Railway");
    expect(html).toContain("Observed uptime: 98%");
    expect(html).toContain("100 checks");
    expect(html).toContain("Partial outage");
    expect(html).toContain("No data");
    expect(html).toContain('href="/status" aria-current="page"');
    expect(html).toContain("Access protected");
    expect(html).toContain("Private service status");
    expect(html).toContain('class="private-status-link"');
    expect(html).toContain('class="uptime-bar-scroll"');
    expect(html).toContain("uptime-scroll-hint");
    expect(html).toContain('href="/manage/status"');
    expect(html).toContain('datetime="2026-07-27T12:00:00.000Z"');
    expect((html.match(/class="uptime-day /g) ?? [])).toHaveLength(180);
    expect(html).toContain('<link rel="stylesheet" href="/assets/tools.css?v=be38fb8a48fb">');
    expect(html).not.toContain('<script src="/assets/ops.js"');
    expect(html).not.toContain("Operator sign-in");
  });

  test("escapes content and allows only HTTP destination links", () => {
    const unsafe: PublicSnapshotDocument = {
      ...publicSnapshot,
      entries: [
        {
          ...publicSnapshot.entries[0],
          name: '<img src=x onerror="alert(1)">',
          links: [
            {
              id: "bad",
              label: "Bad",
              url: "javascript:alert(1)",
              access: "public"
            }
          ]
        }
      ]
    };
    const html = renderPublicPage(unsafe);

    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("javascript:");
  });

  test("distinguishes same-origin navigation from external destinations", () => {
    const html = renderPublicPage(publicSnapshot, "https://uploads.example.test");
    expect(html).toContain('href="/path?a=1&amp;b=2"><span>Open</span><span aria-hidden="true">›</span>');
    expect(html).toContain('href="https://admin.example.test/" target="_blank" rel="noreferrer"');
    expect(html).toContain("opens in a new tab");
  });

  test("cannot render private-only fields because its input is a public projection", () => {
    const html = renderPublicPage(publicSnapshot);

    expect(html).not.toContain("privateNotes");
    expect(html).not.toContain("notification-secret");
    expect(html).not.toContain("raw-discord-error");
  });

  test("renders private-only service status for an authenticated actor", () => {
    const html = renderPrivateStatusPage(
      privateSnapshot,
      "operator@example.test"
    );

    expect(html).toContain("Private services");
    expect(html).toContain("Port service");
    expect(html).toContain("Private tool");
    expect(html).toContain("Signed in as operator@example.test");
    expect(html).toContain('href="/status">← Public status</a>');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).not.toContain("Artifact &lt;Publisher&gt;");
    expect(html).not.toContain("privateNotes");
    expect(html).not.toContain("raw-discord-error");
  });

  test("does not borrow another component status for the Tools Directory row", () => {
    const html = renderStatusPage({
      ...publicSnapshot,
      entries: [
        ...publicSnapshot.entries,
        {
          id: "tools-directory",
          groupId: "publishing",
          name: "Tools Status & Directory",
          description: "The unified service itself.",
          order: 2,
          links: []
        }
      ]
    });

    expect(html).toContain("Tools Status &amp; Directory");
    expect(html).toMatch(
      /<h3>Tools Status &amp; Directory<\/h3>[\s\S]*?<span class="service-state[^"]*">Not monitored<\/span>/
    );
    expect(html).toContain("All monitored services operational");
    expect(html).toContain("2 services not measured");
  });

  test("uses operational overall state only when every listed service is known up", () => {
    const html = renderStatusPage({
      ...publicSnapshot,
      statuses: {
        ...publicSnapshot.statuses,
        "network-console": {
          ...publicSnapshot.statuses["network-console"],
          status: "up",
          checkedAt: generatedAt,
          latencyMs: 51,
          statusCode: 200
        }
      }
    });

    expect(html).toContain("All monitored services operational");
  });

  test("promotes an outage and zero-percent history without operational styling", () => {
    const html = renderStatusPage({
      ...publicSnapshot,
      statuses: {
        ...publicSnapshot.statuses,
        "artifact-publisher": {
          ...publicSnapshot.statuses["artifact-publisher"],
          status: "down",
          uptimeDays: [
            {
              day: "2026-07-27",
              successfulChecks: 0,
              totalChecks: 2
            }
          ]
        }
      }
    });

    expect(html).toContain("Some services are unavailable");
    expect(html).toContain("Service interruption");
    expect(html).toContain("uptime-day--outage");
    expect(html).toMatch(
      /<span class="service-state service-state--outage">Observed uptime: 0%<\/span>/
    );
    expect(html).not.toMatch(
      /<span class="service-state service-state--operational">Observed uptime: 0%<\/span>/
    );
  });

  test("gives checking precedence and reports limited visibility with no measured services", () => {
    const checking = renderStatusPage({
      ...publicSnapshot,
      statuses: {
        ...publicSnapshot.statuses,
        "artifact-publisher": {
          ...publicSnapshot.statuses["artifact-publisher"],
          status: "checking"
        }
      }
    });
    expect(checking).toContain("Service checks are in progress");

    const limited = renderStatusPage({
      ...publicSnapshot,
      statuses: Object.fromEntries(Object.entries(publicSnapshot.statuses).map(([id, status]) => [id, { ...status, status: "paused" }]))
    });
    expect(limited).toContain("Monitoring visibility is limited");
    expect(limited).toContain("2 services not measured");
  });

  test("excludes stale and future checks from paused rolling uptime", () => {
    const html = renderStatusPage({
      ...publicSnapshot,
      statuses: {
        ...publicSnapshot.statuses,
        "artifact-publisher": {
          ...publicSnapshot.statuses["artifact-publisher"],
          status: "paused",
          uptimeDays: [
            { day: "2026-04-28", successfulChecks: 100, totalChecks: 100 },
            { day: "2026-04-29", successfulChecks: 1, totalChecks: 2 },
            { day: "2026-07-27", successfulChecks: 2, totalChecks: 2 },
            { day: "2026-07-28", successfulChecks: 100, totalChecks: 100 },
          ],
        },
      },
    });

    expect(html).toContain("Observed uptime: 75%");
    expect(html).toContain("across 4 checks");
    expect(html).not.toContain("across 204 checks");
  });

  test("labels exact rolling-window coverage, percentages, and check grammar", () => {
    const zero = renderStatusPage({
      ...publicSnapshot,
      statuses: {
        ...publicSnapshot.statuses,
        "artifact-publisher": {
          ...publicSnapshot.statuses["artifact-publisher"],
          status: "down",
          uptimeDays: [
            { day: "2026-04-28", successfulChecks: 10, totalChecks: 10 },
            { day: "2026-04-29", successfulChecks: 0, totalChecks: 1 },
            { day: "2026-07-28", successfulChecks: 10, totalChecks: 10 }
          ]
        }
      }
    });
    expect(zero).toContain("Observed uptime: 0%");
    expect(zero).toContain("1 check ·");
    expect(zero).toContain("Observed since 2026-04-29");
    expect(zero).toContain(
      "Observed uptime: 0% across 1 check; 1 recorded day and 89 no-data days; earliest recorded day 2026-04-29."
    );
    expect(zero).not.toContain("across 21 checks");

    const complete = renderStatusPage({
      ...publicSnapshot,
      statuses: {
        ...publicSnapshot.statuses,
        "artifact-publisher": {
          ...publicSnapshot.statuses["artifact-publisher"],
          uptimeDays: [
            { day: "2026-04-29", successfulChecks: 1, totalChecks: 1 },
            { day: "2026-07-27", successfulChecks: 2, totalChecks: 2 }
          ]
        }
      }
    });
    expect(complete).toContain("Observed uptime: 100%");
    expect(complete).toContain("across 3 checks; 2 recorded days and 88 no-data days");

    const noData = renderStatusPage({
      ...publicSnapshot,
      statuses: {
        ...publicSnapshot.statuses,
        "artifact-publisher": {
          ...publicSnapshot.statuses["artifact-publisher"],
          uptimeDays: []
        }
      }
    });
    expect(noData).toContain(
      "Observed uptime is not available. 0 recorded days and 90 no-data days."
    );
    expect(noData).toContain("No checks recorded");
  });

  test("shows daily uptime and exact downtime on hover with interruption records", () => {
    const html = renderStatusPage({
      ...publicSnapshot,
      generatedAt: "2026-07-27T12:00:00.000Z",
      statuses: {
        ...publicSnapshot.statuses,
        "artifact-publisher": {
          ...publicSnapshot.statuses["artifact-publisher"],
          uptimeDays: [
            { day: "2026-07-27", successfulChecks: 2, totalChecks: 3 }
          ],
          downtimeRecords: [
            {
              startedAt: "2026-07-27T08:00:00.000Z",
              resolvedAt: "2026-07-27T08:07:00.000Z"
            },
            {
              startedAt: "2026-07-27T10:30:00.000Z",
              resolvedAt: null
            }
          ]
        }
      }
    });

    expect(html).toContain(
      "2026-07-27 · 66.667% uptime · 1h 37m recorded downtime · 3 checks"
    );
    expect(html).toContain('class="uptime-popover"');
    expect(html).toContain("Jul 27, 2026");
    expect(html).toContain("66.667% uptime");
    expect(html).toContain("Recorded downtime");
    expect(html).toContain("2 interruptions recorded");
    expect(html).toContain("Downtime records");
    expect(html).toContain("2 interruptions · 1h 37m total");
    expect(html).toContain("08:00–08:07 UTC");
    expect(html).toContain("10:30–ongoing UTC");
    expect(html).toContain('data-local-time-range data-start="2026-07-27T08:00:00.000Z" data-end="2026-07-27T08:07:00.000Z"');
    expect(html).toContain('data-local-time-range data-start="2026-07-27T10:30:00.000Z"');
    expect(html).toContain('class="downtime-duration">7 min</span>');
    expect(html).toContain('class="downtime-duration">1h 30m</span>');
  });

  test("distinguishes stale service observations from snapshot generation", () => {
    const html = renderStatusPage({
      ...publicSnapshot,
      generatedAt: "2026-07-27T15:30:00.000Z",
      statuses: {
        ...publicSnapshot.statuses,
        "artifact-publisher": {
          ...publicSnapshot.statuses["artifact-publisher"],
          checkedAt: "2026-07-26T09:15:00.000Z"
        }
      }
    });

    expect(html).toContain(
      'Last updated <time datetime="2026-07-27T15:30:00.000Z" data-local-timestamp'
    );
    expect(html).toContain(
      'Latest check <time datetime="2026-07-26T09:15:00.000Z" data-local-timestamp'
    );
  });
});

describe("operations page", () => {
  test("renders protected editing actions and revision metadata", () => {
    const html = renderOperationsPage({
      snapshot: privateSnapshot,
      actor: "operator@example.test",
      revision: "revision-1"
    });

    expect(html).toContain("Access protected");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('data-record-search');
    expect(html).toContain('data-focused-editor');
    expect(html).toContain('data-link-row');
    expect(html).toContain('disabled title="Already first"');
    expect(html).toContain('data-revision="revision-1"');
    expect(html).toContain('action="/api/ops/entries/secret"');
    expect(html).toContain("/monitor/pause");
    expect(html).toContain("/archive");
    expect(html).toContain('data-delete-name="Port service"');
    expect(html).toContain("Type the exact name");
    expect(html).toContain("The catalog changed elsewhere");
    expect(html).toContain('data-endpoint="/api/ops/history"');
    expect(html).toContain('data-endpoint="/api/ops/audit"');
    expect(html).toContain("Loading protected history");
    expect(html).toContain("Loading protected audit events");
    expect(html).toContain('<link rel="stylesheet" href="/assets/tools.css?v=be38fb8a48fb">');
    expect(html).toContain('<script src="/assets/ops.js?v=4b98adb" defer></script>');
  });

  test("escapes private values and does not expose notification internals", () => {
    const html = renderOperationsPage({
      snapshot: privateSnapshot,
      actor: '<script data-actor="bad"></script>',
      revision: "revision-1"
    });

    expect(html).toContain("&lt;script data-actor=&quot;bad&quot;&gt;");
    expect(html).toContain(
      "&lt;/textarea&gt;&lt;script&gt;alert(&quot;secret&quot;)&lt;/script&gt;"
    );
    expect(html).not.toContain("</textarea><script>");
    expect(html).not.toContain("raw-discord-error");
    expect(html).not.toContain("notification-secret");
  });

  test("renders accessible protected history and audit pages without leaking publicly", () => {
    const history = renderOperationsHistoryPage({
      items: [
        {
          schemaVersion: 2,
          day: "2026-07-27",
          updatedAt: generatedAt,
          observations: [
            {
              id: "observation-1",
              runId: "run-1",
              monitorId: "artifact-publisher",
              checkedAt: generatedAt,
              success: false,
              statusCode: 503,
              latencyMs: 91,
              errorCode: "http_error"
            },
            {
              id: "legacy-observation",
              runId: "legacy-run",
              monitorId: null,
              checkedAt: generatedAt,
              success: false,
              statusCode: null,
              latencyMs: 0,
              errorCode: "network_error"
            }
          ],
          incidents: [
            {
              id: "incident-1",
              monitorId: "artifact-publisher",
              startedAt: generatedAt,
              openingObservationId: "observation-1",
              resolvedAt: null,
              closingObservationId: null
            }
          ]
        }
      ],
      nextCursor: "older"
    });
    const audit = renderOperationsAuditPage({
      items: [
        {
          schemaVersion: 1,
          id: "audit-1",
          actor: "operator@example.test",
          occurredAt: generatedAt,
          action: "entry.archive",
          targetType: "entry",
          targetId: "artifact-publisher",
          catalogRevisionBefore: "revision-1",
          catalogRevisionAfter: "revision-2"
        }
      ],
      nextCursor: null
    });
    const publicHtml = renderPublicPage(publicSnapshot);

    expect(history).toContain('aria-label="Checks for 2026-07-27"');
    expect(history).toContain(
      "<strong>artifact-publisher</strong><span>Observation observation-1 · Run run-1</span>"
    );
    expect(history).toContain(
      "<strong>Legacy monitor unknown</strong><span>Observation legacy-observation · Run legacy-run</span>"
    );
    expect(history).toContain("http_error");
    expect(history).toContain("Open incident");
    expect(audit).toContain("entry.archive");
    expect(audit).toContain("operator@example.test");
    expect(publicHtml).not.toContain("entry.archive");
    expect(publicHtml).not.toContain("incident-1");
  });
});
