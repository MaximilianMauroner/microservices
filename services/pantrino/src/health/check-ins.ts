import { addDays, type HealthCheckIn } from "@tools-platform/service/bodyshop-contract";
import type { HealthAdapter } from "./contract";
import { resolveViennaTime, viennaTime } from "./nutrition";

const midnight = (day: string) => new Date(resolveViennaTime(`${day}T00:00:00`)!).toISOString();

export async function readHealthCheckIns(
  feature: "steps" | "sleep", adapter: HealthAdapter, now: number, checkActive: () => void, length = 7,
): Promise<HealthCheckIn[]> {
  const today = viennaTime(now).wall.slice(0, 10);
  const first = addDays(today, -length);
  const days = Array.from({ length }, (_, index) => addDays(first, index));
  if (feature === "steps") {
    const rows: HealthCheckIn[] = [];
    for (const day of days) {
      checkActive();
      const steps = await adapter.stepCount(midnight(day), midnight(addDays(day, 1)));
      if (steps !== undefined) rows.push({ day, steps });
    }
    return rows;
  }

  const firstWakeDay = addDays(today, 1 - length);
  const byWakeDay = new Map<string, { start: number; end: number }[]>();
  let cursor: string | undefined;
  do {
    checkActive();
    const page = await adapter.sleepSessions(midnight(addDays(firstWakeDay, -1)), new Date(now).toISOString(), cursor);
    for (const session of page.sessions) {
      const start = Date.parse(session.startTime);
      const end = Date.parse(session.endTime);
      if (!(start < end)) continue;
      const day = viennaTime(end).wall.slice(0, 10);
      if (day < firstWakeDay || day > today || end > now) continue;
      const intervals = byWakeDay.get(day) ?? [];
      for (const period of session.asleep ?? [session]) {
        const from = Math.max(start, Date.parse(period.startTime));
        const to = Math.min(end, Date.parse(period.endTime));
        if (from < to) intervals.push({ start: from, end: to });
      }
      byWakeDay.set(day, intervals);
    }
    cursor = page.next;
  } while (cursor);

  return Array.from(byWakeDay).flatMap(([day, intervals]) => {
    let total = 0;
    let priorEnd = -Infinity;
    for (const { start, end } of intervals.sort((a, b) => a.start - b.start)) {
      total += Math.max(0, end - Math.max(start, priorEnd));
      priorEnd = Math.max(priorEnd, end);
    }
    return total ? [{ day, sleep: Math.min(24, total / 3_600_000) }] : [];
  });
}
