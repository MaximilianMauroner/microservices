import type { KitchenSnapshot, PlanEntry } from "@tools-platform/service/kitchen-contract";
import type { QueuedAction } from "../../sync/model";

export function cookUndo(snapshot: KitchenSnapshot, entry: PlanEntry, leftoverId?: string): QueuedAction[] {
  const undo: QueuedAction[] = [
    ...(leftoverId ? [{ type: "leftover.remove", id: leftoverId } as const] : []),
    { type: "plan.remove", id: entry.id },
    { type: "plan.add", createId: entry.id, day: entry.day, meal: entry.meal, recipeId: entry.recipeId, servings: entry.servings },
  ];
  if (entry.custom) undo.push({ type: "plan.customize", id: entry.id, lines: entry.lines.map(({ ingredientId, amount, note }) => ({ ingredientId, amount, note })) });
  for (const line of entry.lines) {
    const stock = snapshot.stock.find((one) => one.ingredientId === line.ingredientId);
    const consumed = Math.min(stock?.amount ?? 0, line.amount);
    if (consumed > 0) undo.push({ type: "stock.add", ingredientId: line.ingredientId, amount: consumed });
  }
  return undo;
}
