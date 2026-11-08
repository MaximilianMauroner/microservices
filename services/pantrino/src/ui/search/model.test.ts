import type { BodyshopAppSnapshot } from "@tools-platform/service/bodyshop-contract";
import type { KitchenSnapshot } from "@tools-platform/service/kitchen-contract";
import { describe, expect, it } from "vitest";
import { search, searchIndex } from "./model";

const kitchen = {
  kitchen: { id: "home", name: "Home", groups: [], members: [], mcpEnabled: false, hidden: false },
  ingredients: [{ id: "oats", name: "Oats", unit: "g", section: "Grains", otherGroups: [], nutrition: { kcal: 370, protein: 13, carbs: 59, fat: 7 }, notes: "", recipeCount: 1 }],
  recipes: [{ id: "porridge", name: "Porridge with oats", servings: 1, minutes: 5, instructions: "", updatedAt: "", lines: [{ ingredientId: "oats", ingredient: "Oats", unit: "g", amount: 60, note: "" }] }],
  plan: [], stock: [], leftovers: [], extras: [],
} as unknown as KitchenSnapshot;
const body = {
  foods: [{ id: "drink", name: "Oat drink", brand: "Oatly", amount: 100, unit: "ml", nutrients: { kcal: 46, protein: 1, carbs: 6.7, fat: 1.5, fiber: 0.8 } }],
  templates: [{ name: "Oat breakfast", meal: "Breakfast", parts: [] }],
} as unknown as BodyshopAppSnapshot;

describe("search across Kitchen and Bodyshop", () => {
  it("finds matches in both products in one list, whichever product is open", () => {
    const hits = search(searchIndex(kitchen, body), "oat");
    expect(hits.map((hit) => `${hit.product} ${hit.kind} ${hit.label}`)).toEqual([
      "bodyshop meal Oat breakfast", "bodyshop food Oat drink", "kitchen ingredient Oats", "kitchen recipe Porridge with oats",
    ]);
  });

  it("puts the exact name first, matches the brand, and needs every word", () => {
    expect(search(searchIndex(kitchen, body), "oats")[0]!.label).toBe("Oats");
    expect(search(searchIndex(kitchen, body), "oatly").map((hit) => hit.label)).toEqual(["Oat drink"]);
    expect(search(searchIndex(kitchen, body), "oat porridge").map((hit) => hit.label)).toEqual(["Porridge with oats"]);
    expect(search(searchIndex(kitchen, body), "  ")).toEqual([]);
  });

  it("still searches the other product when one is not on the phone", () => {
    expect(search(searchIndex(null, body), "oat").every((hit) => hit.product === "bodyshop")).toBe(true);
    expect(search(searchIndex(kitchen, null), "oat")).toHaveLength(2);
  });

  it("lets Bodyshop log a Kitchen recipe, but a recurring meal goes through its own log", () => {
    const hits = searchIndex(kitchen, body);
    expect(hits.find((hit) => hit.kind === "recipe")?.loggable?.nutrients.kcal).toBe(222);
    expect(hits.find((hit) => hit.kind === "meal")?.loggable).toBeUndefined();
  });
});
