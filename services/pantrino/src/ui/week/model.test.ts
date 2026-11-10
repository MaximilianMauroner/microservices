import { addDays, type Ingredient, type KitchenSnapshot, type PlanEntry, type Recipe } from "@tools-platform/service/kitchen-contract";
import { describe, expect, it } from "vitest";
import { buildWeek, defaultMeal, moveStrip, planStrip, swipeStep } from "./model";

const rice: Ingredient = {
  id: "rice", name: "Rice", unit: "g", section: "Grains", otherGroups: ["Pantry"],
  nutrition: { kcal: 350, protein: null, carbs: null, fat: null }, notes: "", recipeCount: 1,
};
const beans: Ingredient = { ...rice, id: "beans", name: "Beans", unit: "can", section: "Proteins", otherGroups: [] };
const line = { ingredientId: rice.id, ingredient: rice.name, unit: rice.unit, amount: 200, note: "" };
const recipe: Recipe = { id: "bowl", name: "Rice bowl", servings: 2, minutes: 15, instructions: "", updatedAt: "2026-11-05T00:00:00Z", lines: [line] };

function meal(id: string, day: string, patch: Partial<PlanEntry> = {}): PlanEntry {
  return { id, day, meal: "dinner", recipeId: recipe.id, recipe: recipe.name, servings: 2, cooked: false, custom: false, lines: [line], ...patch };
}

function kitchen(patch: Partial<KitchenSnapshot> = {}): KitchenSnapshot {
  return {
    kitchen: { id: "home", name: "Home", groups: ["Proteins", "Grains"], members: [], hidden: false, mcpEnabled: false },
    ingredients: [rice, beans], recipes: [recipe], plan: [], stock: [], leftovers: [], extras: [], ...patch,
  };
}

describe("the local Week page", () => {
  it("shows Monday through Sunday and orders each day's meals", () => {
    const snapshot = kitchen({ plan: [
      meal("previous", "2026-11-01"), meal("next", "2026-11-09"),
      meal("dinner", "2026-11-02"), meal("breakfast", "2026-11-02", { meal: "breakfast" }),
      meal("lunch", "2026-11-02", { meal: "lunch" }), meal("sunday", "2026-11-08", { cooked: true }),
    ] });
    const week = buildWeek(snapshot, "2026-11-05", "2026-10-05");
    expect(week.start).toBe("2026-11-02");
    expect(week.days.map((one) => one.day)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
    expect(week.days[0]!.entries.map((one) => one.id)).toEqual(["breakfast", "lunch", "dinner"]);
    expect(week.entries).toHaveLength(4);
    expect(week.cooked).toBe(1);
    expect(snapshot.plan[2]!.id).toBe("dinner");
  });

  it("counts missing ingredients and extras for this week, using custom meals and stock", () => {
    const snapshot = kitchen({
      plan: [
        meal("custom", "2026-11-05", { custom: true, lines: [{ ...line, amount: 100 }, { ingredientId: beans.id, ingredient: beans.name, unit: beans.unit, amount: 1, note: "" }] }),
        meal("cooked", "2026-11-06", { cooked: true }),
        meal("other-week", "2026-11-09"),
      ],
      stock: [{ ingredientId: rice.id, ingredient: rice.name, unit: rice.unit, section: rice.section, amount: 100 }],
      extras: [
        { id: "bought", name: "Milk", everyWeek: true, boughtWeek: "2026-11-02" },
        { id: "last-week", name: "Tea", everyWeek: true, boughtWeek: "2026-10-26" },
        { id: "not-bought", name: "Coffee", everyWeek: true, boughtWeek: null },
        { id: "once", name: "Soap", everyWeek: false, boughtWeek: null },
      ],
    });
    const week = buildWeek(snapshot, "2026-11-05", "2026-10-05");
    expect(week.toBuy).toBe(4);
    expect(week.buySections).toEqual(["Proteins"]);
    const next = buildWeek(snapshot, "2026-11-09", "2026-10-05");
    expect(next.toBuy).toBe(5);
    expect(next.buySections).toEqual(["Grains"]);
  });

  it("computes calories per serving and preserves all ingredient groups for the plate", () => {
    const week = buildWeek(kitchen(), "2026-11-05", "2026-10-05");
    expect(week.recipes[0]).toMatchObject({ kcal: 350, sections: ["Grains", "Pantry"] });
    const unknown = buildWeek(kitchen({ ingredients: [] }), "2026-11-05", "2026-10-05");
    expect(unknown.recipes[0]).toMatchObject({ kcal: null, sections: ["Other"] });
  });

  it("stops at the first stored week and handles a week across the year boundary", () => {
    const earliest = buildWeek(kitchen(), "2026-09-28", "2026-10-05");
    expect(earliest.start).toBe("2026-10-05");
    expect(earliest.canGoBack).toBe(false);
    expect(buildWeek(kitchen(), "2026-10-12", "2026-10-05").canGoBack).toBe(true);
    const newYear = buildWeek(kitchen(), "2027-01-01", "2026-10-05");
    expect(newYear.days[0]!.day).toBe("2026-12-28");
    expect(newYear.days[6]!.day).toBe("2027-01-03");
  });

  it("shows the leftovers with the first use-by dates first without changing the snapshot", () => {
    const snapshot = kitchen({ leftovers: [
      { id: "later", name: "Rice", servings: 2, useBy: "2026-11-08" },
      { id: "first", name: "Soup", servings: 1, useBy: "2026-11-05" },
    ] });
    expect(buildWeek(snapshot, "2026-11-05", "2026-10-05").leftovers.map((one) => one.id)).toEqual(["first", "later"]);
    expect(snapshot.leftovers[0]!.id).toBe("later");
  });

  it("starts with dinner, then suggests the next meal that is not planned", () => {
    expect(defaultMeal([])).toBe("dinner");
    const dinner = meal("dinner", "2026-11-05");
    expect(defaultMeal([dinner])).toBe("lunch");
    const lunch = meal("lunch", "2026-11-05", { meal: "lunch" });
    const breakfast = meal("breakfast", "2026-11-05", { meal: "breakfast" });
    expect(defaultMeal([dinner, lunch])).toBe("breakfast");
    expect(defaultMeal([dinner, lunch, breakfast])).toBe("snack");
    expect(defaultMeal([dinner, lunch, breakfast, meal("snack", "2026-11-05", { meal: "snack" })])).toBe("dinner");
  });
});

describe("the Plan sheet days", () => {
  const planned = (day: string) => meal(day, day);

  it("offers a week from today and selects the first day without a meal", () => {
    const strip = planStrip({ weekStart: "2026-11-02", today: "2026-11-05", plan: [planned("2026-11-05"), planned("2026-11-07")] });
    expect(strip.days.slice(0, 7)).toEqual(["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11"]);
    expect(strip.days.at(-1), "four weeks scroll in, so a meal can go weeks ahead").toBe("2026-12-02");
    expect(strip.selected).toBe("2026-11-06");
  });

  it("offers the shown week when it starts after today", () => {
    const strip = planStrip({ weekStart: "2026-11-09", today: "2026-11-05", plan: [planned("2026-11-09")] });
    expect(strip.days[0]).toBe("2026-11-09");
    expect(strip.days[6]).toBe("2026-11-15");
    expect(strip.selected).toBe("2026-11-10");
  });

  it("starts at today when the shown week is in the past", () => {
    expect(planStrip({ weekStart: "2026-10-26", today: "2026-11-05", plan: [] }).days[0]).toBe("2026-11-05");
  });

  it("selects today when every offered day has a meal", () => {
    const days = Array.from({ length: 28 }, (_, index) => addDays("2026-11-05", index));
    expect(planStrip({ weekStart: "2026-11-02", today: "2026-11-05", plan: days.map(planned) }).selected).toBe("2026-11-05");
  });

  it("selects the day a person picked, also a past day that already has meals", () => {
    expect(planStrip({ weekStart: "2026-11-02", today: "2026-11-05", plan: [], day: "2026-11-07" }).selected).toBe("2026-11-07");
    const past = planStrip({ weekStart: "2026-11-02", today: "2026-11-05", plan: [planned("2026-11-03")], day: "2026-11-03" });
    expect(past.days[0]).toBe("2026-11-03");
    expect(past.selected).toBe("2026-11-03");
  });
});

describe("the days a meal can move to", () => {
  it("starts on the Monday of the meal's week and reaches three weeks past it", () => {
    const days = moveStrip("2026-11-05");
    expect(days[0]).toBe("2026-11-02");
    expect(days).toContain("2026-11-12");
    expect(days.at(-1)).toBe("2026-11-29");
  });
});

describe("the week swipe", () => {
  it("shows the next week after a swipe to the left and the previous week after a swipe to the right", () => {
    expect(swipeStep(-120, 0)).toBe(1);
    expect(swipeStep(120, 0)).toBe(-1);
  });

  it("counts a short fast flick, but not a short slow drag", () => {
    expect(swipeStep(-40, -800)).toBe(1);
    expect(swipeStep(-40, -100)).toBe(0);
  });

  it("ignores a tiny move even when it is fast, and a drag that comes back", () => {
    expect(swipeStep(10, 2000)).toBe(0);
    expect(swipeStep(-60, 600)).toBe(0);
  });
});
