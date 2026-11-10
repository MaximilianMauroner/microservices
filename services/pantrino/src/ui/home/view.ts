import { byGroupOrder, ingredientGroups, type KitchenSnapshot } from "@tools-platform/service/kitchen-contract";
import { compareText } from "../../compare";

export function pantryShelves(kitchen: KitchenSnapshot) {
  const sections = [
    ...new Set([...kitchen.stock.map((item) => item.section), ...kitchen.ingredients.flatMap(ingredientGroups)]),
  ];
  return sections.sort(byGroupOrder(kitchen.kitchen.groups)).map((section) => ({
    section,
    items: kitchen.stock
      .filter((item) => item.section === section)
      .sort((a, b) => compareText(a.ingredient, b.ingredient)),
  }));
}

export function stockAmount(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const amount = Number(value.replace(",", "."));
  return Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000 ? amount : undefined;
}
