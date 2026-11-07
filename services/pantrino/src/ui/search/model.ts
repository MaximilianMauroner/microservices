import type { BodyshopAppSnapshot } from "@tools-platform/service/bodyshop-contract";
import type { KitchenSnapshot } from "@tools-platform/service/kitchen-contract";
import { fromIngredient, fromRecipe, fromSaved, type Loggable } from "../../body/model";
import type { Mode } from "../../state";

/** One thing a search finds, in Kitchen or in Bodyshop. `loggable` is set when Bodyshop can log it. */
export type SearchHit = Readonly<{
  key: string;
  mode: Mode;
  kind: "recipe" | "ingredient" | "food" | "meal";
  id: string;
  label: string;
  brand: string;
  loggable?: Loggable;
}>;

/** Everything a search can find in the open kitchen and in Bodyshop. A product the person cannot open adds nothing. */
export function searchIndex(kitchen: KitchenSnapshot | null, body: BodyshopAppSnapshot | null): SearchHit[] {
  const ingredients = new Map((kitchen?.ingredients ?? []).map((one) => [one.id, one]));
  return [
    ...(kitchen?.recipes ?? []).map((recipe): SearchHit => ({ key: `recipe:${recipe.id}`, mode: "kitchen", kind: "recipe", id: recipe.id, label: recipe.name, brand: "", loggable: fromRecipe(recipe, ingredients) })),
    ...(kitchen?.ingredients ?? []).map((one): SearchHit => ({ key: `ingredient:${one.id}`, mode: "kitchen", kind: "ingredient", id: one.id, label: one.name, brand: "", loggable: fromIngredient(one) })),
    ...(body?.foods ?? []).map((food): SearchHit => ({ key: `food:${food.id}`, mode: "bodyshop", kind: "food", id: food.id, label: food.name, brand: food.brand, loggable: fromSaved(food) })),
    ...(body?.templates ?? []).map((meal): SearchHit => ({ key: `meal:${meal.name}`, mode: "bodyshop", kind: "meal", id: meal.name, label: meal.name, brand: "" })),
  ];
}

/**
 * The hits whose name or brand holds every typed word. A name that is the query comes first, then names that start with
 * its first word, then the rest by name. Both products mix in one list, so the open mode never hides a match.
 */
export function search(hits: readonly SearchHit[], query: string, limit = 40): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const typed = words.join(" ");
  const score = (hit: SearchHit) => {
    const name = hit.label.toLowerCase();
    return (name === typed ? 4 : 0) + (name.startsWith(words[0]!) ? 2 : 0);
  };
  return hits
    .filter((hit) => words.every((word) => `${hit.label} ${hit.brand}`.toLowerCase().includes(word)))
    .map((hit) => ({ hit, score: score(hit) }))
    .sort((a, b) => b.score - a.score || a.hit.label.localeCompare(b.hit.label))
    .slice(0, limit)
    .map((one) => one.hit);
}
