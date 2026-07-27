import {
  CATALOG_SCHEMA_VERSION,
  CHECKER_STATE_SCHEMA_VERSION,
  type CatalogDocument,
  type CheckerStateDocument
} from "../src/index.js";

export const NOW = "2026-07-27T12:00:00.000Z";

export function catalogFixture(): CatalogDocument {
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    revision: "catalog-1",
    updatedAt: NOW,
    groups: [
      {
        id: "operations",
        name: "Operations",
        description: "Operational tools",
        order: 0,
        visibility: "public"
      },
      {
        id: "private",
        name: "Private",
        order: 1,
        visibility: "private"
      }
    ],
    entries: [
      {
        id: "public-tool",
        groupId: "operations",
        name: "Public tool",
        description: "Safe description",
        order: 0,
        visibility: "public",
        lifecycle: "active",
        privateNotes: "never publish",
        links: [
          {
            id: "public-link",
            label: "Open",
            url: "https://tool.example/",
            access: "public"
          },
          {
            id: "restricted-link",
            label: "Operations",
            url: "https://ops.example/",
            access: "restricted"
          },
          {
            id: "private-link",
            label: "Secret",
            url: "https://private.example/",
            access: "private"
          }
        ],
        monitor: {
          enabled: true,
          paused: false,
          scope: "public",
          url: "https://health.example/"
        }
      },
      {
        id: "tailnet-tool",
        groupId: "operations",
        name: "Tailnet tool",
        description: "Tailnet only",
        order: 1,
        visibility: "public",
        lifecycle: "active",
        links: [],
        monitor: {
          enabled: true,
          paused: false,
          scope: "tailscale",
          url: "https://tailnet.example/"
        }
      },
      {
        id: "private-tool",
        groupId: "private",
        name: "Private tool",
        description: "Must not escape",
        order: 0,
        visibility: "private",
        lifecycle: "active",
        links: [],
        privateNotes: "classified"
      },
      {
        id: "archived-tool",
        groupId: "operations",
        name: "Archived",
        description: "Old",
        order: 2,
        visibility: "public",
        lifecycle: "archived",
        links: []
      }
    ]
  };
}

export function stateFixture(): CheckerStateDocument {
  return {
    schemaVersion: CHECKER_STATE_SCHEMA_VERSION,
    revision: "state-1",
    updatedAt: NOW,
    lastRunId: "run-1",
    monitors: {
      "public-tool": {
        monitorId: "public-tool",
        status: "up",
        consecutiveFailures: 0,
        latestObservation: {
          id: "observation-1",
          runId: "run-1",
          checkedAt: NOW,
          success: true,
          statusCode: 200,
          latencyMs: 42,
          errorCode: null
        },
        openIncidentId: null,
        uptimeDays: [
          {
            day: "2026-07-27",
            successfulChecks: 99,
            totalChecks: 100
          }
        ]
      }
    },
    incidents: [],
    notifications: [],
    historyPending: []
  };
}
