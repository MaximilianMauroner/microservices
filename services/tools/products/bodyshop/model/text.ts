/** The sheet's TEXT() number and date patterns, so labels read exactly as in the workbook. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Rounds half away from zero, as the sheet does. */
function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor + 1e-9)) / factor;
}

/**
 * FLOOR(value, step) and CEILING(value, step). The value is first cut to 12 decimals, as spreadsheet arithmetic
 * keeps about 15 significant digits, so 3450.0000000000005 stays 3450.
 */
export function toMultiple(value: number, step: number, direction: "floor" | "ceil"): number {
  const steps = Number((value / step).toFixed(12));
  return (direction === "floor" ? Math.floor(steps) : Math.ceil(steps)) * step;
}

/** TEXT(value, "0"), "0.0", or "0.00". */
export function fixed(value: number, digits = 0): string {
  const text = round(value, digits).toFixed(digits);
  return text === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : text;
}

/** TEXT(value, "#,##0"). */
export function grouped(value: number): string {
  const [whole] = fixed(value).split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** TEXT(value, "+0.00;-0.00;0.00") and the one-digit form. */
export function signed(value: number, digits = 2): string {
  const text = fixed(Math.abs(value), digits);
  if (Number(text) === 0) return text;
  return `${value > 0 ? "+" : "-"}${text}`;
}

/** TEXT(day, "d mmm"), "dd mmm yyyy", and "d mmm yyyy". */
export function dayLabel(day: string, pattern: "d mmm" | "dd mmm yyyy" | "d mmm yyyy"): string {
  const [year, month, date] = day.split("-");
  const name = MONTHS[Number(month) - 1];
  if (pattern === "d mmm") return `${Number(date)} ${name}`;
  return `${pattern === "dd mmm yyyy" ? date : Number(date)} ${name} ${year}`;
}
