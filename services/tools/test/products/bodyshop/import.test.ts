import { describe, expect, it } from "vitest";
import type { DaySummary } from "../../../products/bodyshop/domain.js";
import { IMPORT_SHEETS, planImport, reconcile } from "../../../products/bodyshop/import/plan.js";
import { readWorkbook } from "../../../products/bodyshop/import/workbook.js";
import { entryNutrients } from "../../../products/bodyshop/model/day.js";
import { eatingWorkbook, HEADERS, row, workbook } from "./workbook-fixture.js";

const plan = (bytes: Uint8Array) => planImport(readWorkbook(bytes, IMPORT_SHEETS));

describe("Bodyshop workbook import", () => {
  it("turns every source row into a record, with dates, ranges, comments, and aliases read the way the sheet shows them", () => {
    const result = plan(eatingWorkbook());
    expect(result.errors).toEqual([]);
    expect(Object.fromEntries(Object.entries(result.records).map(([kind, list]) => [kind, list.length]))).toEqual({ food: 2, entry: 2, template: 2, weight: 1, checkin: 1, allocation: 0, setting: 1 });

    const [butter, cake] = result.records.entry.map((one) => one.record);
    expect(butter).toMatchObject({ day: "2026-09-22", meal: "Breakfast", amount: 14, range: 0.05, notes: "Comment on Ref fiber: Label says 0 g fiber." });
    expect(entryNutrients(butter!).kcal).toBeCloseTo(100.24);
    expect(result.records.entry[0]!.source).toBe("Food Log!2");

    // Typed totals become the entry's own snapshot, so the day keeps the values the sheet showed.
    expect(cake).toMatchObject({ range: 0.35, fiberRange: 0.35, reference: { amount: 30, unit: "g", nutrients: { kcal: 97.8, protein: 2.1 } } });
    expect(entryNutrients(cake!).kcal).toBeCloseTo(97.8);
    expect(result.warnings.map((note) => note.source)).toContain("Food Log!3");

    const [savedButter, semmel] = result.records.food.map((one) => one.record);
    expect(savedButter).toMatchObject({ fullSize: { amount: 250, unit: "g" }, container: "pack", verified: "2026-10-01" });
    expect(semmel!.verified).toBeNull();
    expect(result.warnings.some((note) => note.source === "Foods!3" && note.message.includes("about October"))).toBe(true);

    expect(result.records.template[0]!.record).toMatchObject({ aliases: ["normal breakfast", "usual breakfast"], quantity: "Variable", effectiveFrom: "2026-09-17" });
    expect(result.records.checkin[0]!.record).toMatchObject({ reported: "Complete", override: null, steps: 8000 });
  });

  it("stops on a missing sheet or column and names it", () => {
    const result = plan(workbook({ "Food Log": [HEADERS["Food Log"].filter((header) => header !== "Meal"), row("Food Log", {})] }));
    expect(result.errors.map((note) => note.message)).toEqual(expect.arrayContaining([`The column "Meal" is missing.`, `The sheet "Foods" is missing.`]));
  });

  it("refuses a file that is not a workbook", () => {
    expect(() => plan(new TextEncoder().encode("Date,Food\n2026-11-03,Apple"))).toThrow("not a readable xlsx workbook");
  });

  it("names each day and value where Bodyshop and the sheet differ", () => {
    const summary = { day: "2026-09-22", kcal: 200, protein: 10, carbs: 20, fat: 5, fiber: null, low: { kcal: null, protein: null, carbs: null, fat: null, fiber: null }, high: { kcal: null, protein: null, carbs: null, fat: null, fiber: null }, check: "Review Food Log checks", status: "Complete", basis: "", entries: 2, coverage: 0.5, evidence: "" } as DaySummary;
    const values = { kcal: 200.004, protein: 12, carbs: 20, fat: 5, fiber: null, kcalLow: null, kcalHigh: null, proteinLow: null, proteinHigh: null, carbsLow: null, carbsHigh: null, fatLow: null, fatHigh: null, fiberLow: null, fiberHigh: null, status: "Complete", check: "Review Food Log checks", entries: 2, coverage: 0.5 };
    const result = reconcile({ sheetDays: [{ day: "2026-09-22", values }], sheetWeights: [{ day: "2026-09-22", actual: 104.2, trend: 104.2 }] }, [summary], [{ day: "2026-09-22", actual: 104.2, trend: 104.1 }]);
    expect(result.differences).toEqual([{ day: "2026-09-22", field: "protein", sheet: 12, bodyshop: 10 }]);
    expect(result).toMatchObject({ days: 1, matchingDays: 0, weights: 1, matchingWeights: 0 });
    expect(result.weightDifferences).toEqual([{ day: "2026-09-22", field: "trend weight", sheet: 104.2, bodyshop: 104.1 }]);
  });
});
