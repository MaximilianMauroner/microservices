import {
  CATALOG_SCHEMA_VERSION,
  CHECKER_STATE_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  BUCKET_KEYS,
  type CatalogDocument,
  type PrivateSnapshotDocument,
  type PublicSnapshotDocument
} from "@tools-platform/domain";
import {
  BucketConflictError,
  type ConditionalWrite,
  type JsonBucket
} from "../src/bucket.js";

export const catalog: CatalogDocument = {
  schemaVersion: CATALOG_SCHEMA_VERSION,
  revision: "revision_1",
  updatedAt: "2026-07-27T00:00:00.000Z",
  groups: [
    {
      id: "public-tools",
      name: "Public tools",
      order: 0,
      visibility: "public"
    },
    {
      id: "operations",
      name: "Operations",
      order: 1,
      visibility: "private"
    }
  ],
  entries: [
    {
      id: "artifact-publisher",
      groupId: "public-tools",
      name: "Artifact Publisher",
      description: "Publishes temporary artifacts.",
      order: 0,
      visibility: "public",
      lifecycle: "active",
      links: [
        {
          id: "public",
          label: "Open",
          url: "https://uploads.example.test/",
          access: "public"
        },
        {
          id: "admin",
          label: "Admin",
          url: "https://uploads.example.test/private",
          access: "private"
        }
      ],
      monitor: {
        enabled: true,
        paused: false,
        scope: "public",
        url: "https://uploads.example.test/health"
      },
      privateNotes: "secret operator note"
    }
  ]
};

export const publicSnapshot: PublicSnapshotDocument = {
  schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  generatedAt: "2026-07-27T00:05:00.000Z",
  catalogRevision: catalog.revision,
  groups: [{ id: "public-tools", name: "Public tools", order: 0 }],
  entries: [
    {
      id: "artifact-publisher",
      groupId: "public-tools",
      name: "Artifact Publisher",
      description: "Publishes temporary artifacts.",
      order: 0,
      links: [
        {
          id: "public",
          label: "Open",
          url: "https://uploads.example.test/",
          access: "public"
        }
      ]
    }
  ],
  statuses: {
    "artifact-publisher": {
      monitorId: "artifact-publisher",
      status: "up",
      checkedAt: "2026-07-27T00:05:00.000Z",
      latencyMs: 20,
      statusCode: 200
    }
  }
};

export const privateSnapshot: PrivateSnapshotDocument = {
  schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  generatedAt: "2026-07-27T00:05:00.000Z",
  catalogRevision: catalog.revision,
  catalog,
  state: {
    schemaVersion: CHECKER_STATE_SCHEMA_VERSION,
    revision: "state_1",
    updatedAt: "2026-07-27T00:05:00.000Z",
    lastRunId: null,
    monitors: {},
    incidents: [],
    notifications: []
  }
};

interface Stored {
  body: unknown;
  etag: string;
}

export class MemoryBucket implements JsonBucket {
  readonly objects = new Map<string, Stored>();
  readonly writes: Array<{ key: string; body: unknown; condition?: ConditionalWrite }> = [];
  conflictNextWrite = false;
  conflictCatalogWrite = false;
  failCatalogWrite = false;
  commitCatalogThenFail = false;
  failCanonicalAuditWrites = 0;
  beforeNextCatalogRead: (() => void) | undefined;
  reads = 0;

  seed(key: string, body: unknown, etag: string): void {
    this.objects.set(key, { body, etag });
  }

  async get(key: string) {
    this.reads += 1;
    if (key === BUCKET_KEYS.catalog && this.beforeNextCatalogRead) {
      const callback = this.beforeNextCatalogRead;
      this.beforeNextCatalogRead = undefined;
      callback();
    }
    return this.objects.get(key) ?? null;
  }

  async put(key: string, body: unknown, condition?: ConditionalWrite) {
    if (this.conflictCatalogWrite && key === "catalog/current.json") {
      this.conflictCatalogWrite = false;
      throw new BucketConflictError();
    }
    if (this.failCatalogWrite && key === BUCKET_KEYS.catalog) {
      this.failCatalogWrite = false;
      throw new Error("simulated ambiguous catalog write failure");
    }
    if (
      this.failCanonicalAuditWrites > 0 &&
      /^audit\/\d{4}\/\d{2}\//.test(key)
    ) {
      this.failCanonicalAuditWrites -= 1;
      throw new Error("simulated audit write failure");
    }
    if (this.conflictNextWrite) {
      this.conflictNextWrite = false;
      throw new BucketConflictError();
    }
    const current = this.objects.get(key);
    if (
      (condition?.ifNoneMatch === "*" && current) ||
      (condition?.ifMatch !== undefined && current?.etag !== condition.ifMatch)
    ) {
      throw new BucketConflictError();
    }
    const etag = `etag-${this.writes.length + 1}`;
    this.objects.set(key, { body, etag });
    this.writes.push({
      key,
      body,
      ...(condition === undefined ? {} : { condition })
    });
    if (this.commitCatalogThenFail && key === BUCKET_KEYS.catalog) {
      this.commitCatalogThenFail = false;
      throw new Error("simulated lost catalog write response");
    }
    return etag;
  }

  async list(prefix: string, cursor: string | undefined, limit: number) {
    const keys = [...this.objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort();
    const offset = cursor === undefined ? 0 : Number(cursor);
    const page = keys.slice(offset, offset + limit);
    const next = offset + page.length;
    return {
      keys: page,
      ...(next < keys.length ? { nextCursor: String(next) } : {})
    };
  }

  async listAfter(prefix: string, after: string | undefined, limit: number) {
    return [...this.objects.keys()]
      .filter(
        (key) =>
          key.startsWith(prefix) && (after === undefined || key > after)
      )
      .sort()
      .slice(0, limit);
  }
}
