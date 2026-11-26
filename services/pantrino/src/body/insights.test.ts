import type { BodyshopTrendDay } from "@tools-platform/service/bodyshop-contract";
import { expect, it } from "vitest";
import { insightCoverage, overview, weeklyPatterns } from "./insights";

const trend = (day: string, values: Partial<BodyshopTrendDay>): BodyshopTrendDay => ({
  day, kcal: null, protein: null, carbs: null, fat: null, fiber: null, steps: null, sleep: null, ...values,
});

it("compares recorded days without counting gaps or today's unfinished totals", () => {
  const days = [
    trend("2026-11-08", { steps: 3000 }),
    trend("2026-11-10", { steps: 6000 }),
    trend("2026-11-12", { steps: 9000 }),
    trend("2026-11-15", { steps: 0 }),
    trend("2026-11-17", { steps: 10000 }),
    trend("2026-11-19", { steps: 8000 }),
    trend("2026-11-20", { steps: 2, sleep: 8 }),
  ];

  expect(overview(days, [], "2026-11-20", 7)).toEqual(expect.arrayContaining([
    { metric: "steps", value: 6000, prior: 6000, count: 3 },
    { metric: "sleep", value: 8, prior: null, count: 1 },
  ]));
});

it("uses complete food logs and withholds comparisons with sparse data", () => {
  const days = [
    trend("2026-11-14", { kcal: 110, status: "Partial" }),
    trend("2026-11-15", { kcal: 2100, status: "Complete" }),
    trend("2026-11-16", { kcal: 1900, status: "Complete" }),
    trend("2026-11-20", { kcal: 300, status: "Complete" }),
  ];
  expect(overview(days, [], "2026-11-20", 7)).toContainEqual({ metric: "kcal", value: 2000, prior: null, count: 2 });
});

it("distinguishes a recorded zero, a partial food log, and an unfinished day on the calendar", () => {
  const days = [
    trend("2026-11-19", { steps: 0, kcal: 500, status: "Partial" }),
    trend("2026-11-20", { steps: 800, sleep: 7.5, kcal: 2000, status: "Complete" }),
  ];
  expect(insightCoverage(days, [], "2026-11-20", 2)).toEqual([
    { day: "2026-11-19", weight: false, steps: true, sleep: false, kcal: false },
    { day: "2026-11-20", weight: false, steps: false, sleep: true, kcal: false },
  ]);
});

it("compares weekdays and weekends using completed dates and enough readings in each group", () => {
  const days = [
    ...[2, 3, 4].map((day) => trend(`2026-11-0${day}`, { steps: 3000, sleep: 6 })),
    ...["01", "07", "08"].map((day) => trend(`2026-11-${day}`, { steps: 9000 })),
    trend("2026-11-09", { steps: 15000 }),
  ];
  expect(weeklyPatterns(days, "2026-11-09", 30)).toEqual([
    { metric: "steps", groups: [{ count: 3, average: 3000 }, { count: 3, average: 9000 }] },
  ]);
});
