import {
  CATALOG_SCHEMA_VERSION,
  CHECKER_STATE_SCHEMA_VERSION,
  type CatalogDocument,
  type CheckerStateDocument,
  type HistoryPartitionDocument,
  type PrivateSnapshotDocument,
  type PublicSnapshotDocument
} from "@tools-platform/domain";
import type {
  CheckerStore,
  Versioned
} from "../src/bucket.js";
import type { CheckerConfig } from "../src/config.js";

export const NOW = new Date("2026-07-27T12:01:00.000Z");

export const configFixture: CheckerConfig = {
  environment: "test",
  bucket: {
    name: "bucket",
    endpoint: "https://bucket.example",
    region: "auto",
    accessKeyId: "access",
    secretAccessKey: "secret",
    forcePathStyle: false
  },
  concurrency: 2,
  probeTimeoutMs: 10_000,
  runDeadlineMs: 240_000,
  notificationAttemptLimit: 8
};

export function catalogFixture(): CatalogDocument {
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    revision: "catalog-1",
    updatedAt: NOW.toISOString(),
    groups: [
      {
        id: "tools",
        name: "Tools",
        order: 0,
        visibility: "public"
      }
    ],
    entries: [
      entry("public-a", "public"),
      entry("tailnet-a", "tailscale"),
      {
        ...entry("paused-a", "public"),
        monitor: {
          ...entry("paused-a", "public").monitor!,
          paused: true
        }
      },
      {
        ...entry("disabled-a", "public"),
        monitor: {
          ...entry("disabled-a", "public").monitor!,
          enabled: false
        }
      }
    ]
  };
}

function entry(
  id: string,
  scope: "public" | "tailscale"
): CatalogDocument["entries"][number] {
  return {
    id,
    groupId: "tools",
    name: id,
    description: id,
    order: 0,
    visibility: "public",
    lifecycle: "active",
    links: [],
    monitor: {
      tracking: "http",
      enabled: true,
      paused: false,
      scope,
      url:
        scope === "public"
          ? `https://${id}.example/`
          : "https://tailnet.example/"
    }
  };
}

export class MemoryStore implements CheckerStore {
  catalog: Versioned<CatalogDocument> = {
    value: catalogFixture(),
    etag: "catalog-etag"
  };
  state: Versioned<CheckerStateDocument> | null = null;
  history = new Map<string, Versioned<HistoryPartitionDocument>>();
  publicSnapshot: PublicSnapshotDocument | null = null;
  privateSnapshot: PrivateSnapshotDocument | null = null;
  stateWrites = 0;
  historyWrites = 0;
  historyReads: string[] = [];
  historyWriteError: Error | null = null;
  closed = false;

  async readCatalog() {
    return this.catalog;
  }

  async readState() {
    return this.state;
  }

  async readHistory(day: string) {
    this.historyReads.push(day);
    return this.history.get(day) ?? null;
  }

  async listHistoryDays() {
    return [...this.history.keys()].sort();
  }

  async writeState(
    value: CheckerStateDocument,
    expectedEtag: string | null
  ) {
    expectEtag(this.state?.etag ?? null, expectedEtag);
    const etag = `state-${++this.stateWrites}`;
    this.state = { value, etag };
    return etag;
  }

  async writeHistory(
    value: HistoryPartitionDocument,
    expectedEtag: string | null
  ) {
    if (this.historyWriteError) {
      throw this.historyWriteError;
    }
    expectEtag(this.history.get(value.day)?.etag ?? null, expectedEtag);
    const etag = `history-${++this.historyWrites}`;
    this.history.set(value.day, { value, etag });
    return etag;
  }

  async writePublicSnapshot(value: PublicSnapshotDocument) {
    this.publicSnapshot = value;
  }

  async writePrivateSnapshot(value: PrivateSnapshotDocument) {
    this.privateSnapshot = value;
  }

  close() {
    this.closed = true;
  }
}

export function emptyState(): CheckerStateDocument {
  return {
    schemaVersion: CHECKER_STATE_SCHEMA_VERSION,
    revision: "initial",
    updatedAt: NOW.toISOString(),
    lastRunId: null,
    monitors: {},
    incidents: [],
    notifications: [],
    historyPending: []
  };
}

export const logger = {
  info() {},
  error() {}
};

function expectEtag(actual: string | null, expected: string | null) {
  if (actual !== expected) {
    throw new Error(`ETag conflict: expected ${expected}, found ${actual}`);
  }
}
