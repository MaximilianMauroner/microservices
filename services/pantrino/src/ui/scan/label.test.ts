import { describe, expect, it } from "vitest";
import { labelDisagrees, type OcrLine, readLabel, tableRows } from "./label";

/** A photo's lines as OCR returns them: label column and value columns as separate lines, a little off level. */
function photo(rows: readonly (readonly string[])[], tilt = 3): OcrLine[] {
  return rows.flatMap((cells, row) => cells.map((text, column) => {
    const top = row * 40 + column * tilt;
    return { text, frame: { left: column * 300, top, right: column * 300 + 250, bottom: top + 30 } };
  })).reverse();
}

describe("nutrition table photos", () => {
  it("rebuilds rows from columns and reads the per 100 g column of a German table", () => {
    const lines = photo([
      ["Nährwerte", "pro 100 g", "pro Portion (15 g)"],
      ["Brennwert", "2252 kJ / 539 kcal", "338 kJ / 81 kcal"],
      ["Fett", "30,9 g", "4,6 g"],
      ["davon gesättigte Fettsäuren", "10,6 g", "1,6 g"],
      ["Kohlenhydrate", "57,5 g", "8,6 g"],
      ["davon Zucker", "56,3 g", "8,4 g"],
      ["Ballaststoffe", "0 g", "0 g"],
      ["Eiweiß", "6,3 g", "0,9 g"],
      ["Salz", "0,107 g", "0,016 g"],
    ]);
    expect(tableRows(lines)[2]).toBe("Fett 30,9 g 4,6 g");
    expect(readLabel(lines)).toEqual({ values: { kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9, fiber: 0 }, unit: "g", found: 5 });
  });

  it("reads an English table per 100 ml, with kJ/kcal written as a pair", () => {
    const lines = photo([
      ["Typical values", "per 100ml"],
      ["Energy kJ/kcal", "192/46"],
      ["Fat", "1.5g"],
      ["of which saturates", "0.2g"],
      ["Carbohydrate", "6.7g"],
      ["Fibre", "0.8g"],
      ["Protein", "1.0g"],
    ]);
    expect(readLabel(lines)).toEqual({ values: { kcal: 46, protein: 1, carbs: 6.7, fat: 1.5, fiber: 0.8 }, unit: "ml", found: 5 });
  });

  it("works out calories from kJ, mends an O read in place of a zero, and keeps what it cannot read empty", () => {
    const lines = photo([["Energie", "1O50 kJ"], ["Eiweiß", "1O,5 g"], ["Fett", "unleserlich"]]);
    expect(readLabel(lines)).toEqual({ values: { kcal: 251, protein: 10.5, carbs: null, fat: null, fiber: null }, unit: null, found: 2 });
  });

  it("drops values that cannot be true per 100 g, and finds nothing in a photo without a table", () => {
    expect(readLabel(photo([["Fett", "309 g"], ["Energie", "5390 kcal"]])).values).toMatchObject({ fat: null, kcal: null });
    expect(readLabel(photo([["Mindestens haltbar bis", "12.2027"]])).found).toBe(0);
  });

  it("flags calories that do not fit the macros, a sign of a misread digit", () => {
    expect(labelDisagrees({ kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9, fiber: null })).toBe(false);
    expect(labelDisagrees({ kcal: 139, protein: 6.3, carbs: 57.5, fat: 30.9, fiber: null })).toBe(true);
    expect(labelDisagrees({ kcal: 539, protein: null, carbs: 57.5, fat: 30.9, fiber: null })).toBe(false);
  });
});
