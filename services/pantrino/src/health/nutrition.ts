import { addDays, type NutritionChange } from "@tools-platform/service/bodyshop-contract";
import type { NutritionRecord } from "./contract";

const vienna = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
  minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function viennaTime(instant: number) {
  const parts = Object.fromEntries(vienna.formatToParts(instant).map(({ type, value }) => [type, value]));
  const wall = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  const minutes = (Date.parse(`${wall}Z`) - Math.floor(instant / 1000) * 1000) / 60_000;
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const remainder = String(absolute % 60).padStart(2, "0");
  return { wall, offset: `${minutes < 0 ? "-" : "+"}${hours}:${remainder}` };
}

function iso(instant: number) {
  const { wall, offset } = viennaTime(instant);
  const milliseconds = new Date(instant).toISOString().slice(19, 23);
  return `${wall}${milliseconds}${offset}`;
}

export function resolveViennaTime(wall: string) {
  const asUtc = Date.parse(`${wall}Z`);
  const candidates = [-24, 24].map((hours) => Date.parse(wall + viennaTime(asUtc + hours * 3_600_000).offset));
  return candidates.filter((instant) => viennaTime(instant).wall === wall).sort((a, b) => a - b)[0];
}

export function nutritionRecord(change: NutritionChange, namespace: string, dayStartHour: number): NutritionRecord | null {
  const { food } = change;
  if (!food) return null;
  const clock = food.time?.match(/^([01]\d|2[0-3]):[0-5]\d$/)?.[0];
  const exact = clock ? resolveViennaTime(`${addDays(food.day, Number(clock.slice(0, 2)) < dayStartHour ? 1 : 0)}T${clock}:00`) : undefined;
  // Day-level records cover their diary date. Keeping both endpoints within that date
  // avoids distributing an unknown-time meal over two Health Connect calendar days.
  const start = exact ?? resolveViennaTime(`${food.day}T00:00:00`)!;
  const end = exact === undefined ? resolveViennaTime(`${addDays(food.day, 1)}T00:00:00`)! - 1 : exact + 1;
  return {
    id: nutritionId(namespace, change.id), revision: change.revision, name: food.food,
    meal: food.meal, nutrients: food.nutrients, start: iso(start), end: iso(end),
  };
}

export function nutritionId(namespace: string, id: string) {
  return `bodyshop:${namespace}:${id}`;
}
