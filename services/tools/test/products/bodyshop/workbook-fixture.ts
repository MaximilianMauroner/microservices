import { strToU8, zipSync } from "fflate";

/** A cell: a number, a text, empty, or a formula with the value it showed. */
export type Value = string | number | null | { f: string; v: number | string };

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function column(index: number): string {
  let name = "";
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
  return name;
}

function cell(ref: string, value: Value): string {
  if (value === null) return "";
  if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
  if (typeof value === "string") return `<c r="${ref}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
  return typeof value.v === "number"
    ? `<c r="${ref}"><f>${escape(value.f)}</f><v>${value.v}</v></c>`
    : `<c r="${ref}" t="str"><f>${escape(value.f)}</f><v>${escape(value.v)}</v></c>`;
}

/**
 * Builds an xlsx file with the given sheets, each a list of rows starting at row 1. `comments` maps a sheet
 * name to cell comments such as { AA2: "Label says 0 g" }.
 */
export function workbook(sheets: Readonly<Record<string, readonly (readonly Value[])[]>>, comments: Readonly<Record<string, Readonly<Record<string, string>>>> = {}): Uint8Array {
  const names = Object.keys(sheets);
  const files: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, index) => `<sheet name="${escape(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>`)
  };
  names.forEach((name, index) => {
    const rows = sheets[name]!.map((row, at) => `<row r="${at + 1}">${row.map((value, col) => cell(`${column(col)}${at + 1}`, value)).join("")}</row>`).join("");
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`);
    const notes = comments[name];
    if (notes) {
      files[`xl/worksheets/_rels/sheet${index + 1}.xml.rels`] = strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="c1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments${index + 1}.xml"/></Relationships>`);
      files[`xl/comments${index + 1}.xml`] = strToU8(`<?xml version="1.0"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><commentList>${Object.entries(notes).map(([ref, text]) => `<comment ref="${ref}"><text><r><t>${escape(text)}</t></r></text></comment>`).join("")}</commentList></comments>`);
    }
  });
  return zipSync(files);
}

export const HEADERS = {
  "Food Log": ["Date", "Time", "Meal", "Food", "Amount", "Unit", "Calories", "Protein (g)", "Carbs (g)", "Fat (g)", "Fiber (g)", "Source", "Notes", "Range ±", "Kcal low", "Kcal high", "Fiber range ±", "Fiber low (g)", "Fiber high (g)", "Data check", "Ref amount", "Ref unit", "Ref kcal", "Ref protein", "Ref carbs", "Ref fat", "Ref fiber", "Ref nutrition ±", "Ref fiber ±", "Ref food", "Protein low", "Protein high", "Carbs low", "Carbs high", "Fat low", "Fat high", "Reference notes"],
  Foods: ["Food / alias", "Brand / description", "Reference amount", "Unit", "Calories", "Protein (g)", "Carbs (g)", "Fat (g)", "Fiber (g)", "Notes", "Full size amount", "Full size unit", "Container / shorthand", "Full size notes", "Nutrition source", "Source reference", "Verified / observed date", "Confidence", "Nutrition estimate ±", "Fiber estimate ±", "Fiber source / estimate notes"],
  "Meal Templates": ["Template", "Aliases", "Component order", "Food / alias", "Default amount", "Unit", "Quantity type", "Meal", "Effective from", "Calories", "Protein (g)", "Carbs (g)", "Fat (g)", "Fiber (g)", "Notes", "Version status"],
  Weight: ["Date", "Weight (kg)", "Notes", "Weight source"],
  "Check-ins": ["Date", "Reported status (history)", "Training", "Training notes", "Steps", "Activity notes", "Hunger (1-5)", "Fatigue (1-5)", "Recovery (1-5)", "Sleep (h)", "Notes", "Calories logged", "Protein logged", "Weight (kg)", "Completion basis", "Completion override", "Effective food status", "Effective completion basis"],
  "Multi-day allocations": ["Allocation date", "Food-source date", "Allocation fraction", "Reporting basis", "Coverage period"],
  Settings: ["Setting", "Value", "Unit", "Notes"]
} as const;

/** A row in the column order of `HEADERS[sheet]`, from the named values. */
export function row(sheet: keyof typeof HEADERS, values: Readonly<Record<string, Value>>): Value[] {
  return HEADERS[sheet].map((header) => values[header] ?? null);
}

/**
 * A small Eating workbook: butter from a saved food, cake with typed values, a template with a variable bread part,
 * one weight, and one check-in, all on 2026-09-22 (serial 46287).
 */
export function eatingWorkbook(extra: { settings?: readonly (readonly Value[])[]; weight?: number } = {}): Uint8Array {
  return workbook({
    "Food Log": [[...HEADERS["Food Log"]],
      row("Food Log", { Date: 46287, Meal: "Breakfast", Food: "Butter", Amount: 14, Unit: "g", Calories: { f: "=E2/U2*W2", v: 100.24 }, Source: "Saved food", "Range ±": { f: "=AB2", v: 0.05 }, "Fiber range ±": { f: "=AC2", v: 0.05 },
        "Ref amount": 100, "Ref unit": "g", "Ref kcal": 716, "Ref protein": 0.7, "Ref carbs": 0.6, "Ref fat": 81, "Ref fiber": 0, "Ref nutrition ±": 0.05, "Ref fiber ±": 0.05, "Ref food": "Butter" }),
      row("Food Log", { Date: 46287, Meal: "Snack", Food: "Cake", Amount: 30, Unit: "g", Calories: 97.8, "Protein (g)": 2.1, "Carbs (g)": 21.3, "Fat (g)": 1, "Fiber (g)": 0.5, Source: "Estimated", "Range ±": "35%", "Fiber range ±": "35%" })],
    Foods: [[...HEADERS.Foods],
      row("Foods", { "Food / alias": "Butter", "Reference amount": 100, Unit: "g", Calories: 716, "Protein (g)": 0.7, "Carbs (g)": 0.6, "Fat (g)": 81, "Fiber (g)": 0, "Full size amount": 250, "Full size unit": "g", "Container / shorthand": "pack", "Verified / observed date": "2026-10-01", "Nutrition estimate ±": 0.05, "Fiber estimate ±": 0.05 }),
      row("Foods", { "Food / alias": "Semmel", "Reference amount": 1, Unit: "piece", Calories: 160, "Protein (g)": 5, "Carbs (g)": 31, "Fat (g)": 1, "Fiber (g)": 1.5, "Verified / observed date": "about October", "Nutrition estimate ±": 0.1, "Fiber estimate ±": 0.2 })],
    "Meal Templates": [[...HEADERS["Meal Templates"]],
      row("Meal Templates", { Template: "Normal breakfast", Aliases: "normal breakfast, usual breakfast", "Component order": 1, "Food / alias": "Bread item (variable)", "Default amount": 1, Unit: "piece", "Quantity type": "Variable", Meal: "Breakfast", "Effective from": 46282 }),
      row("Meal Templates", { Template: "Normal breakfast", Aliases: "normal breakfast, usual breakfast", "Component order": 2, "Food / alias": "Butter", "Default amount": 14, Unit: "g", "Quantity type": "Fixed", Meal: "Breakfast", "Effective from": 46282 })],
    Weight: [[...HEADERS.Weight], row("Weight", { Date: 46287, "Weight (kg)": extra.weight ?? 104.2, "Weight source": "Scale" })],
    "Check-ins": [[...HEADERS["Check-ins"]], row("Check-ins", { Date: 46287, "Reported status (history)": "Complete", Steps: 8000, "Completion override": "Auto" })],
    "Multi-day allocations": [[...HEADERS["Multi-day allocations"]]],
    Settings: [[...HEADERS.Settings], ...(extra.settings ?? [["Daily calorie target", 2300, "kcal", ""]])]
  }, { "Food Log": { AA2: "Label says 0 g fiber." } });
}
