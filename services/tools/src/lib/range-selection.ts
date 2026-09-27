/** Toggle one visible row, or add the inclusive range from the last unmodified click. */
export function toggleVisibleRange(current: ReadonlySet<string>, visibleIds: readonly string[], anchor: string | undefined, target: string, shiftKey: boolean): Set<string> {
  const start = anchor === undefined ? -1 : visibleIds.indexOf(anchor);
  const end = visibleIds.indexOf(target);
  const range = shiftKey && start >= 0 && end >= 0
    ? visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1)
    : [target];
  const next = new Set(current);
  if (range.length === 1 && next.has(target)) next.delete(target);
  else range.forEach((id) => next.add(id));
  return next;
}

/** Select or clear exactly the visible result set without touching hidden results. */
export function toggleVisibleAll(current: ReadonlySet<string>, visibleIds: readonly string[]): Set<string> {
  const next = new Set(current);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => next.has(id));
  visibleIds.forEach((id) => allSelected ? next.delete(id) : next.add(id));
  return next;
}
