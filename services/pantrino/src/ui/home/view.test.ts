import type { KitchenSnapshot } from "@tools-platform/service/kitchen-contract";
import { describe, expect, it } from "vitest";
import { pantryShelves, stockAmount } from "./view";

describe("the local pantry", () => {
  it("keeps empty shelves for ingredient groups and puts stock only in its main group", () => {
    const snapshot: KitchenSnapshot = {
      kitchen: {
        id: "home",
        name: "Home",
        mcpEnabled: false,
        hidden: false,
        members: [],
        groups: ["Protein", "Basics"],
      },
      ingredients: [
        {
          id: "beans",
          name: "Beans",
          unit: "can",
          section: "Basics",
          otherGroups: ["Protein"],
          nutrition: { kcal: null, protein: null, carbs: null, fat: null },
          notes: "",
          recipeCount: 0,
        },
      ],
      stock: [
        { ingredientId: "salt", ingredient: "Salt", unit: "g", section: "Other", amount: 100 },
        { ingredientId: "beans", ingredient: "Beans", unit: "can", section: "Basics", amount: 2 },
      ],
      recipes: [],
      plan: [],
      leftovers: [],
      extras: [],
    };
    expect(pantryShelves(snapshot)).toMatchObject([
      { section: "Protein", items: [] },
      { section: "Basics", items: [{ ingredient: "Beans", amount: 2 }] },
      { section: "Other", items: [{ ingredient: "Salt", amount: 100 }] },
    ]);
  });

  it("accepts decimal commas and zero but does not clear stock for an empty or invalid field", () => {
    expect(stockAmount("1,5")).toBe(1.5);
    expect(stockAmount(" 2.25 ")).toBe(2.25);
    expect(stockAmount("0")).toBe(0);
    for (const input of ["", " ", "-1", "Infinity", "milk", "1,2,3", "1000001"])
      expect(stockAmount(input)).toBeUndefined();
  });
});
