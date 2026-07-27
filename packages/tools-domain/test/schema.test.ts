import { describe, expect, it } from "vitest";
import {
  CATALOG_SCHEMA_VERSION,
  CHECKER_STATE_SCHEMA_VERSION,
  HISTORY_SCHEMA_VERSION,
  SchemaDecodeError,
  decodeAdminAuditRecord,
  decodeCatalogDocument,
  decodeCheckerStateDocument,
  decodeHistoryPartitionDocument,
  decodePrivateSnapshotDocument,
  decodePublicSnapshotDocument
} from "../src/index.js";
import { NOW, catalogFixture, stateFixture } from "./fixtures.js";

describe("schema decoding and migration", () => {
  it("decodes current catalog and checker state documents", () => {
    expect(decodeCatalogDocument(catalogFixture())).toEqual(catalogFixture());
    expect(decodeCheckerStateDocument(stateFixture())).toEqual(stateFixture());
  });

  it("migrates explicit v0 catalog defaults to v1", () => {
    const current = catalogFixture();
    const legacy = {
      schemaVersion: 0,
      revision: current.revision,
      updatedAt: current.updatedAt,
      groups: current.groups.map(({ visibility: _visibility, ...group }) => group),
      entries: current.entries.map(
        ({
          visibility: _visibility,
          lifecycle: _lifecycle,
          monitor,
          ...entry
        }) => ({
          ...entry,
          links: entry.links.map(({ access: _access, ...link }) => link),
          ...(monitor
            ? {
                monitor: {
                  enabled: monitor.enabled,
                  url: monitor.url
                }
              }
            : {})
        })
      )
    };

    const migrated = decodeCatalogDocument(legacy);
    expect(migrated.schemaVersion).toBe(CATALOG_SCHEMA_VERSION);
    expect(migrated.groups.every(({ visibility }) => visibility === "private"))
      .toBe(true);
    expect(
      migrated.entries.every(
        ({ visibility, lifecycle }) =>
          visibility === "private" && lifecycle === "active"
      )
    ).toBe(true);
    expect(migrated.entries[0].monitor).toMatchObject({
      paused: false,
      scope: "public"
    });
  });

  it("migrates explicit v0 checker state defaults to v1", () => {
    const state = stateFixture();
    const legacy = {
      schemaVersion: 0,
      revision: state.revision,
      updatedAt: state.updatedAt,
      monitors: state.monitors,
      incidents: state.incidents
    };
    expect(decodeCheckerStateDocument(legacy)).toMatchObject({
      schemaVersion: CHECKER_STATE_SCHEMA_VERSION,
      lastRunId: null,
      notifications: []
    });
  });

  it("rejects unsupported, malformed, and relationally invalid documents", () => {
    expect(() =>
      decodeCatalogDocument({ ...catalogFixture(), schemaVersion: 99 })
    ).toThrow(/unsupported catalog schema version/);
    expect(() =>
      decodeCatalogDocument({ ...catalogFixture(), updatedAt: "yesterday" })
    ).toThrow(SchemaDecodeError);
    expect(() =>
      decodeCatalogDocument({
        ...catalogFixture(),
        entries: [
          {
            ...catalogFixture().entries[0],
            groupId: "missing"
          }
        ]
      })
    ).toThrow(/unknown group/);
    expect(() =>
      decodeCheckerStateDocument({
        ...stateFixture(),
        monitors: {
          wrong: stateFixture().monitors["public-tool"]
        }
      })
    ).toThrow(/must match its map key/);
  });

  it("decodes generated public and private snapshots", () => {
    const publicSnapshot = {
      schemaVersion: 1,
      generatedAt: NOW,
      catalogRevision: "catalog-1",
      groups: [],
      entries: [],
      statuses: {}
    };
    expect(decodePublicSnapshotDocument(publicSnapshot)).toEqual(publicSnapshot);
    expect(
      decodePublicSnapshotDocument({ ...publicSnapshot, schemaVersion: 0 })
    ).toEqual(publicSnapshot);
    expect(
      decodePrivateSnapshotDocument({
        schemaVersion: 1,
        generatedAt: NOW,
        catalogRevision: "catalog-1",
        catalog: catalogFixture(),
        state: stateFixture()
      })
    ).toMatchObject({ generatedAt: NOW });
  });

  it("migrates and decodes daily history partitions", () => {
    const observation =
      stateFixture().monitors["public-tool"].latestObservation;
    if (!observation) {
      throw new Error("Fixture observation is required");
    }
    expect(
      decodeHistoryPartitionDocument({
        schemaVersion: 0,
        day: "2026-07-27",
        updatedAt: NOW,
        observations: [observation]
      })
    ).toEqual({
      schemaVersion: HISTORY_SCHEMA_VERSION,
      day: "2026-07-27",
      updatedAt: NOW,
      observations: [{ ...observation, monitorId: null }],
      incidents: []
    });
    expect(() =>
      decodeHistoryPartitionDocument({
        schemaVersion: 1,
        day: "2026-02-30",
        updatedAt: NOW,
        observations: [],
        incidents: []
      })
    ).toThrow(/valid YYYY-MM-DD/);
  });

  it.each(["http://127.0.0.1/", "http://[::1]/"])(
    "rejects blocked literal monitor URL %s at the catalog boundary",
    (url) => {
      const catalog = catalogFixture();
      expect(() =>
        decodeCatalogDocument({
          ...catalog,
          entries: catalog.entries.map((entry, index) =>
            index === 0
              ? {
                  ...entry,
                  monitor: {
                    enabled: true,
                    paused: false,
                    scope: "public",
                    url
                  }
                }
              : entry
          )
        })
      ).toThrow(/public HTTP\(S\) URL/);
    }
  );

  it("decodes safe audit metadata without authentication material", () => {
    expect(
      decodeAdminAuditRecord({
        schemaVersion: 1,
        id: "audit-1",
        actor: "owner@example.com",
        occurredAt: NOW,
        action: "entry.update",
        targetType: "entry",
        targetId: "public-tool",
        catalogRevisionBefore: "catalog-1",
        catalogRevisionAfter: "catalog-2"
      })
    ).toMatchObject({
      actor: "owner@example.com",
      action: "entry.update",
      targetId: "public-tool"
    });
  });
});
