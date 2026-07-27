import type {
  CatalogDocument,
  CatalogEntry,
  CatalogGroup
} from "@tools-platform/domain";

export class MutationError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400
  ) {
    super(message);
    this.name = "MutationError";
  }
}

export function addGroup(
  catalog: CatalogDocument,
  group: CatalogGroup
): CatalogDocument {
  if (catalog.groups.some(({ id }) => id === group.id)) {
    throw new MutationError("Group already exists", 409);
  }
  return { ...catalog, groups: [...catalog.groups, group] };
}

export function replaceGroup(
  catalog: CatalogDocument,
  id: string,
  group: CatalogGroup
): CatalogDocument {
  if (group.id !== id) throw new MutationError("Group ID cannot change");
  requireGroup(catalog, id);
  return {
    ...catalog,
    groups: catalog.groups.map((current) => (current.id === id ? group : current))
  };
}

export function deleteGroup(
  catalog: CatalogDocument,
  id: string
): CatalogDocument {
  requireGroup(catalog, id);
  if (catalog.entries.some(({ groupId }) => groupId === id)) {
    throw new MutationError("Group must be empty before deletion", 409);
  }
  return {
    ...catalog,
    groups: catalog.groups.filter((group) => group.id !== id)
  };
}

export function addEntry(
  catalog: CatalogDocument,
  entry: CatalogEntry
): CatalogDocument {
  if (catalog.entries.some(({ id }) => id === entry.id)) {
    throw new MutationError("Entry already exists", 409);
  }
  requireGroup(catalog, entry.groupId);
  return { ...catalog, entries: [...catalog.entries, entry] };
}

export function replaceEntry(
  catalog: CatalogDocument,
  id: string,
  entry: CatalogEntry
): CatalogDocument {
  if (entry.id !== id) throw new MutationError("Entry ID cannot change");
  requireEntry(catalog, id);
  requireGroup(catalog, entry.groupId);
  return {
    ...catalog,
    entries: catalog.entries.map((current) => (current.id === id ? entry : current))
  };
}

export function deleteEntry(
  catalog: CatalogDocument,
  id: string
): CatalogDocument {
  requireEntry(catalog, id);
  return {
    ...catalog,
    entries: catalog.entries.filter((entry) => entry.id !== id)
  };
}

export function archiveEntry(
  catalog: CatalogDocument,
  id: string
): CatalogDocument {
  return mapEntry(catalog, id, (entry) => ({ ...entry, lifecycle: "archived" }));
}

export function setMonitorPaused(
  catalog: CatalogDocument,
  id: string,
  paused: boolean
): CatalogDocument {
  return mapEntry(catalog, id, (entry) => {
    if (!entry.monitor) throw new MutationError("Entry has no monitor", 409);
    return { ...entry, monitor: { ...entry.monitor, paused } };
  });
}

export function reorder(
  catalog: CatalogDocument,
  input: unknown
): CatalogDocument {
  const body = record(input);
  const groupIds = stringArray(body.groupIds, "groupIds");
  const entries = record(body.entryIdsByGroup);
  assertExactIds(groupIds, catalog.groups.map(({ id }) => id), "groupIds");
  const entryOrders = new Map<string, number>();
  for (const group of catalog.groups) {
    const ids = stringArray(entries[group.id], `entryIdsByGroup.${group.id}`);
    const expected = catalog.entries
      .filter(({ groupId }) => groupId === group.id)
      .map(({ id }) => id);
    assertExactIds(ids, expected, `entryIdsByGroup.${group.id}`);
    ids.forEach((id, order) => entryOrders.set(id, order));
  }
  if (Object.keys(entries).some((key) => !catalog.groups.some(({ id }) => id === key))) {
    throw new MutationError("entryIdsByGroup contains an unknown group");
  }
  const groupOrders = new Map(groupIds.map((id, order) => [id, order]));
  return {
    ...catalog,
    groups: catalog.groups.map((group) => ({
      ...group,
      order: groupOrders.get(group.id) ?? group.order
    })),
    entries: catalog.entries.map((entry) => ({
      ...entry,
      order: entryOrders.get(entry.id) ?? entry.order
    }))
  };
}

function mapEntry(
  catalog: CatalogDocument,
  id: string,
  map: (entry: CatalogEntry) => CatalogEntry
): CatalogDocument {
  requireEntry(catalog, id);
  return {
    ...catalog,
    entries: catalog.entries.map((entry) => (entry.id === id ? map(entry) : entry))
  };
}

function requireGroup(catalog: CatalogDocument, id: string): void {
  if (!catalog.groups.some((group) => group.id === id)) {
    throw new MutationError("Group not found", 404);
  }
}

function requireEntry(catalog: CatalogDocument, id: string): void {
  if (!catalog.entries.some((entry) => entry.id === id)) {
    throw new MutationError("Entry not found", 404);
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MutationError("Expected a JSON object");
  }
  return Object.fromEntries(Object.entries(value));
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new MutationError(`${name} must be an array of IDs`);
  }
  return [...value];
}

function assertExactIds(actual: string[], expected: string[], name: string): void {
  if (
    new Set(actual).size !== actual.length ||
    actual.length !== expected.length ||
    expected.some((id) => !actual.includes(id))
  ) {
    throw new MutationError(`${name} must contain every ID exactly once`);
  }
}
