import { describe, expect, it } from "vitest";
import type { Ingredient, KitchenSnapshot, Recipe } from "@tools-platform/service/kitchen-contract";
import { filterRecipes, recipeDraftError, recipeSummaries } from "./model";

const rice: Ingredient = {
  id: "rice", name: "Rice", unit: "g", section: "Grains", otherGroups: [],
  nutrition: { kcal: 360, protein: 8, carbs: 80, fat: 1 }, notes: "", recipeCount: 2
};
const beans: Ingredient = {
  id: "beans", name: "Beans", unit: "can", section: "Protein", otherGroups: ["Grains"],
  nutrition: { kcal: 200, protein: null, carbs: 20, fat: 1 }, notes: "", recipeCount: 2
};
const bowl: Recipe = {
  id: "bowl", name: "Rice bowl", servings: 2, minutes: 20, instructions: "Cook.", updatedAt: "",
  lines: [
    { ingredientId: rice.id, ingredient: rice.name, unit: rice.unit, amount: 200, note: "" },
    { ingredientId: beans.id, ingredient: beans.name, unit: beans.unit, amount: 1, note: "" }
  ]
};
const soup: Recipe = { ...bowl, id: "soup", name: "Bean soup", lines: [bowl.lines[1]!] };
const plainRice: Recipe = { ...bowl, id: "plain", name: "Plain rice", lines: [bowl.lines[0]!] };
const idea: Recipe = { ...bowl, id: "idea", name: "Rice pudding", minutes: null, lines: [] };
const snapshot: Pick<KitchenSnapshot, "recipes" | "ingredients" | "stock"> = {
  recipes: [soup, bowl, idea, plainRice], ingredients: [rice, beans],
  stock: [{ ingredientId: rice.id, ingredient: rice.name, unit: rice.unit, section: rice.section, amount: 200 }]
};

describe("recipe list", () => {
  it("shows per-serving nutrition and all ingredient groups, while unknown nutrition stays unknown", () => {
    const summaries = recipeSummaries(snapshot);
    expect(summaries.find((one) => one.id === bowl.id)).toMatchObject({
      kcal: 460, protein: null, ingredientCount: 2,
      ingredientIds: ["rice", "beans"], sections: ["Grains", "Protein", "Grains"], missing: ["Beans"]
    });
    expect(summaries.find((one) => one.id === idea.id)).toMatchObject({ kcal: null, protein: null, ingredientCount: 0 });
  });

  it("finds names without case or surrounding spaces and keeps ideas in normal results", () => {
    const summaries = recipeSummaries(snapshot);
    expect(filterRecipes(summaries, " RICE ", [], false).map((one) => one.id)).toEqual(["bowl", "idea", "plain"]);
    expect(filterRecipes(summaries, "curry", [], false)).toEqual([]);
  });

  it("requires every selected ingredient and combines that filter with the name", () => {
    const summaries = recipeSummaries(snapshot);
    expect(filterRecipes(summaries, "", ["rice", "beans"], false).map((one) => one.id)).toEqual(["bowl"]);
    expect(filterRecipes(summaries, "soup", ["rice"], false)).toEqual([]);
    expect(filterRecipes(summaries, "", ["beans"], false).map((one) => one.id)).toEqual(["soup", "bowl"]);
  });

  it("ranks recipes by missing ingredients, keeps partial matches, and removes ideas when cooking from home", () => {
    const summaries = recipeSummaries({ ...snapshot, stock: [{ ...snapshot.stock[0]!, amount: 100 }] });
    expect(filterRecipes(summaries, "", [], true).map((one) => [one.id, one.missing])).toEqual([
      ["soup", ["Beans"]], ["plain", ["Rice"]], ["bowl", ["Rice", "Beans"]]
    ]);
    expect(filterRecipes(recipeSummaries(snapshot), "", [], true).map((one) => one.id)).toEqual(["plain", "soup", "bowl"]);
    expect(summaries.map((one) => one.id)).toEqual(["soup", "bowl", "idea", "plain"]);
  });

  it("treats exact stock as enough and recomputes after stock or nutrition changes", () => {
    const before = recipeSummaries(snapshot).find((one) => one.id === plainRice.id)!;
    expect(before.missing).toEqual([]);
    const after = recipeSummaries({ ...snapshot, stock: [], ingredients: [{ ...rice, nutrition: { ...rice.nutrition, kcal: 100 } }, beans] }).find((one) => one.id === plainRice.id)!;
    expect(after).toMatchObject({ kcal: 100, missing: ["Rice"] });
    expect(recipeSummaries({ ...snapshot, ingredients: [rice] }).find((one) => one.id === soup.id)).toMatchObject({ kcal: null, sections: ["Other"] });
  });
});

describe("recipe drafts", () => {
  const line = { key: "one", ingredientId: "rice", name: "Rice", unit: "g" as const, amount: "1,5", note: "" };

  it("allows a name-only idea, localized amounts, and an unchanged recipe name", () => {
    expect(recipeDraftError("Curry", "", [], snapshot.recipes)).toBeUndefined();
    expect(recipeDraftError("Rice bowl", "20", [line], snapshot.recipes, bowl.id)).toBeUndefined();
  });

  it("rejects blank or duplicate names, repeated ingredients, and invalid minutes before queuing", () => {
    expect(recipeDraftError("  ", "", [], snapshot.recipes)).toBe("nameRequired");
    expect(recipeDraftError(" RICE   bowl ", "", [], snapshot.recipes)).toBe("nameInUse");
    expect(recipeDraftError("Curry", "0", [], snapshot.recipes)).toBe("minutesInvalid");
    expect(recipeDraftError("Curry", "10001", [], snapshot.recipes)).toBe("minutesInvalid");
    expect(recipeDraftError("Curry", "1.5", [], snapshot.recipes)).toBe("minutesInvalid");
    expect(recipeDraftError("Curry", "", [line, { ...line, key: "two" }], snapshot.recipes)).toBe("duplicateIngredient");
    expect(recipeDraftError("Curry", "", [line, { ...line, key: "two", ingredientId: undefined, name: " rice " }], snapshot.recipes)).toBe("duplicateIngredient");
    expect(recipeDraftError("Curry", "", [{ ...line, ingredientId: undefined, name: "Lentils" }, { ...line, key: "two", ingredientId: undefined, name: " lentils " }], snapshot.recipes)).toBe("duplicateIngredient");
    expect(recipeDraftError("Curry", "", [{ ...line, ingredientId: undefined, name: "Red lentils" }, { ...line, key: "two", ingredientId: undefined, name: " red  lentils " }], snapshot.recipes)).toBe("duplicateIngredient");
  });

  it("rejects missing, infinite, and excessive ingredient amounts", () => {
    for (const amount of ["", "0", "-1", "Infinity", "1000001"]) {
      expect(recipeDraftError("Curry", "", [{ ...line, amount }], snapshot.recipes)).toBe("amountInvalid");
    }
  });
});
