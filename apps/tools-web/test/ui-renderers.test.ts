import { describe, expect, test } from "vitest";
import type {
  PrivateSnapshotDocument,
  PublicSnapshotDocument
} from "@tools-platform/domain";
import {
  renderOperationsPage,
  renderPublicPage
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
      statusCode: 200
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
    schemaVersion: 1,
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
        status: "pending",
        attempts: 1,
        nextAttemptAt: null,
        deliveredAt: null,
        lastErrorCode: "raw-discord-error"
      }
    ]
  }
};

describe("public page", () => {
  test("renders semantic grouped cards, status, and labeled restricted links", () => {
    const html = renderPublicPage(publicSnapshot);

    expect(html).toContain('<main id="main"');
    expect(html).toContain('aria-labelledby="group-publishing"');
    expect(html).toContain('role="list"');
    expect(html).toContain("Operational");
    expect(html).toContain("Unavailable from Railway");
    expect(html).toContain("Restricted");
    expect(html).toContain("restricted access");
    expect(html).not.toContain('<script src="/assets/ops.js"');
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
});
