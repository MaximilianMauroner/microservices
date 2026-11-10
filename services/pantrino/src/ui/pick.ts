import { byGroupOrder } from "@tools-platform/service/kitchen-contract";

/** One row a person can select. `group` places it under a food group heading. */
export type PickItem = Readonly<{ id: string; label: string; detail?: string; group: string }>;

/** The items whose label holds the typed text, under their groups in the kitchen's group order and by name inside a group. */
export function pickSections(items: readonly PickItem[], groups: readonly string[], query: string): [string, PickItem[]][] {
  const typed = query.trim().toLowerCase();
  const sections = new Map<string, PickItem[]>();
  for (const item of items) if (item.label.toLowerCase().includes(typed)) sections.set(item.group, [...sections.get(item.group) ?? [], item]);
  const order = byGroupOrder(groups);
  return [...sections].sort(([a], [b]) => order(a, b)).map(([group, rows]) => [group, rows.sort((a, b) => a.label.localeCompare(b.label))]);
}
