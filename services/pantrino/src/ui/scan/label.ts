/** One line of text that on-device recognition found in a photo, with its box in image pixels. */
export type OcrLine = Readonly<{ text: string; frame: Readonly<{ left: number; top: number; right: number; bottom: number }> }>;

export const LABEL_NUTRIENTS = ["kcal", "protein", "carbs", "fat", "fiber"] as const;
export type LabelNutrient = (typeof LABEL_NUTRIENTS)[number];
export type LabelValues = Readonly<Record<LabelNutrient, number | null>>;

/** What a photo of a nutrition table says per 100 g or 100 ml. A value the photo does not show clearly stays null. */
export type LabelReading = Readonly<{ values: LabelValues; unit: "g" | "ml" | null; found: number }>;

const LABELS: Readonly<Record<Exclude<LabelNutrient, "kcal">, { match: RegExp; not?: RegExp }>> = {
  fat: { match: /\b(fett|fat|lipides|grassi)\b/, not: /gesattigt|saturat|fettsaur|davon|of which|dont/ },
  carbs: { match: /kohlenhydrat|carbohydrate|glucides|carboidrati/, not: /zucker|sugar|sucres|davon|of which/ },
  protein: { match: /eiwei(ss|b)|protein|proteines|proteine/ },
  fiber: { match: /ballaststoff|fibre|fiber|fibres/ },
};

/** Lines whose middles sit at about the same height, left to right. A table photo lists label and values in columns, so a row is rebuilt from them. */
export function tableRows(lines: readonly OcrLine[]): string[] {
  const sorted = [...lines].filter((line) => line.text.trim()).sort((a, b) => middle(a) - middle(b));
  const rows: OcrLine[][] = [];
  for (const line of sorted) {
    const row = rows.at(-1);
    const height = Math.max(1, line.frame.bottom - line.frame.top);
    if (row && Math.abs(middle(line) - middle(row[0]!)) < height * 0.5) row.push(line);
    else rows.push([line]);
  }
  return rows.map((row) => row.sort((a, b) => a.frame.left - b.frame.left).map((line) => line.text.trim()).join(" "));
}

/**
 * Reads a nutrition table. It takes the first value of each row, because tables list per 100 g or 100 ml first and a
 * serving after it. Calories come from kcal, or from kJ when only kJ shows. A value that cannot be true per 100 g is dropped.
 */
export function readLabel(lines: readonly OcrLine[]): LabelReading {
  const rows = tableRows(lines).map(plain);
  const all = rows.join("\n");
  const kcal = firstBefore(all, "kcal") ?? pairedKcal(all);
  const kj = firstBefore(all, "kj");
  const values: Record<LabelNutrient, number | null> = {
    kcal: within(kcal ?? (kj === null ? null : Math.round(kj / 4.184)), 900),
    protein: null, carbs: null, fat: null, fiber: null,
  };
  for (const [nutrient, label] of Object.entries(LABELS) as [Exclude<LabelNutrient, "kcal">, (typeof LABELS)[keyof typeof LABELS]][]) {
    const row = rows.find((one) => label.match.test(one) && !label.not?.test(one));
    if (row) values[nutrient] = within(firstGrams(row.replace(label.match, " ")), 100);
  }
  const unit = /100\s*ml\b/.test(all) ? "ml" : /100\s*g\b/.test(all) ? "g" : null;
  return { values, unit, found: Object.values(values).filter((value) => value !== null).length };
}

/**
 * True when the calories and the macros disagree by more than a quarter, a sign that a digit was misread.
 * It says nothing when a value is missing.
 */
export function labelDisagrees(values: LabelValues): boolean {
  const { kcal, protein, carbs, fat } = values;
  if (kcal === null || protein === null || carbs === null || fat === null || kcal < 40) return false;
  return Math.abs(protein * 4 + carbs * 4 + fat * 9 - kcal) / kcal > 0.25;
}

function middle(line: OcrLine) {
  return (line.frame.top + line.frame.bottom) / 2;
}

/** Lower case without accents, with decimal commas as points, and with an O that OCR read in place of a zero inside a number. */
function plain(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss")
    .replace(/(?<=\d)[o](?=[\d,.\s]|g\b)|(?<=[\s<]|^)[o](?=[,.]\d)/g, "0")
    .replace(/(\d)\s*,\s*(\d)/g, "$1.$2");
}

const NUMBER = String.raw`(\d+(?:\.\d+)?)`;

function firstBefore(text: string, unit: "kcal" | "kj"): number | null {
  const found = new RegExp(`${NUMBER}\\s*${unit}\\b`).exec(text);
  return found ? Number(found[1]) : null;
}

/** Tables that head the energy row "kJ/kcal" write the values as "2252/539". */
function pairedKcal(text: string): number | null {
  const row = text.split("\n").find((one) => /kj\s*\/\s*kcal/.test(one));
  const found = row && new RegExp(`${NUMBER}\\s*\\/\\s*${NUMBER}`).exec(row.replace(/kj\s*\/\s*kcal/, " "));
  return found ? Number(found[2]) : null;
}

/** The first amount in grams, or else the first number, since OCR often drops a lone "g". */
function firstGrams(text: string): number | null {
  const found = new RegExp(`${NUMBER}\\s*g\\b`).exec(text) ?? new RegExp(NUMBER).exec(text);
  return found ? Number(found[1]) : null;
}

function within(value: number | null, max: number): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
}
