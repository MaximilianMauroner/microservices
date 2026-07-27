import { describe, expect, test } from "vitest";
import type {
  PrivateSnapshotDocument,
  PublicSnapshotDocument
} from "@tools-platform/domain";
import {
  renderOperationsAuditPage,
  renderOperationsHistoryPage,
  renderOperationsPage,
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
    expect(html).toContain('aria-current="page">Tools');
    expect(html).toContain("Publishing &amp; sharing");
    expect(html).toContain("Cloudflare Access");
    expect(html).toContain("Tailscale required");
    expect(html).toContain("Operational");
    expect(html).toContain("Unavailable from Railway");
    expect(html).not.toContain("Operator sign-in");
    expect(html).not.toContain('<script src="/assets/ops.js"');
  });

  test("renders the status summary, exact history bars, and labeled restricted links", () => {
    const html = renderStatusPage(publicSnapshot);

    expect(html).toContain('<main id="main"');
    expect(html).toContain('aria-labelledby="status-title"');
    expect(html).toContain('aria-labelledby="services-title"');
    expect(html).toContain('role="list"');
    expect(html).toContain("Status is being prepared");
    expect(html).not.toContain("All services are operational");
    expect(html).toContain("Operational");
    expect(html).toContain("Not checkable from Railway");
    expect(html).toContain("98% uptime");
    expect(html).toContain("100 checks");
    expect(html).toContain('href="/status" aria-current="page"');
    expect(html).toContain("Access protected");
    expect(html).toContain('datetime="2026-07-27T12:00:00.000Z"');
    expect((html.match(/class="uptime-day /g) ?? [])).toHaveLength(180);
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

  test("cannot render private-only fields because its input is a public projection", () => {
    const html = renderPublicPage(publicSnapshot);

    expect(html).not.toContain("privateNotes");
    expect(html).not.toContain("notification-secret");
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
    expect(html).toContain("Status is being prepared");
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

    expect(html).toContain("All services are operational");
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
      /<span class="service-state service-state--outage">0% uptime<\/span>/
    );
    expect(html).not.toMatch(
      /<span class="service-state service-state--operational">0% uptime<\/span>/
    );
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

    expect(html).toContain("75% uptime");
    expect(html).toContain("across 4 checks");
    expect(html).not.toContain("across 204 checks");
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
      'Last updated <time datetime="2026-07-27T15:30:00.000Z"'
    );
    expect(html).toContain(
      'Latest check <time datetime="2026-07-26T09:15:00.000Z"'
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
    expect(html).toContain('<script src="/assets/ops.js" defer></script>');
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
