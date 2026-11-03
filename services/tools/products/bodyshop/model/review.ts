import { addDays, type DaySummary, daysBetween } from "../domain.js";
import type { Settings } from "../settings.js";
import type { StepEnergy } from "./energy.js";
import type { ModelSummary } from "./engine.js";
import { mean } from "./stats.js";
import { grouped } from "./text.js";
import type { DailyWeight } from "./weight.js";

/** One day of the current week as the log shows it. These are log states, not nutrition grades. */
export type WeekDay = Readonly<{ day: string; status: "Complete" | "Partial" | "Unconfirmed" | "No log" | "Not due"; kcal: string }>;

/** One Monday-to-Sunday week. Nutrition averages use complete days only; the week stops at the review date. */
export type ReviewWeek = Readonly<{
  start: string;
  completeDays: number;
  kcal: number | null;
  /** Average calories minus the calorie target. */
  vsTarget: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  weight: number | null;
  weightDays: number;
  /** The mean half-range of complete days, or Review when a complete day still has entries to check. */
  kcalRange: number | "Review" | null;
}>;

/** One week of food in minus estimated step-based expenditure. Sums cover closed, complete, step-estimated days only. */
export type EnergyWeek = Readonly<{
  start: string;
  /** Usable days of the possible closed days, such as "6/7", or "Outside history". */
  coverage: string;
  food: number | null;
  energyOut: number | null;
  /** Positive is an estimated surplus, negative an estimated deficit. */
  net: number | null;
  assessment: "Outside history" | "No usable days" | "Start of record" | "Week to date" | "Covered" | "Partial evidence";
}>;

/** The weekly review (sheet "Weekly Review"). */
export type WeeklyReview = Readonly<{
  /** The current week to date: days with intake data, complete-day averages, and measured weights. */
  intakeDays: number;
  completeDays: number;
  kcal: number | null;
  protein: number | null;
  weight: number | null;
  weightDays: number;
  completeText: string;
  week: readonly WeekDay[];
  /** The last twelve weeks, newest first. */
  weeks: readonly ReviewWeek[];
  /** Net energy of this calendar week and of the last seven closed days. */
  weekNet: number | null;
  weekCoverage: string;
  sevenDayNet: number | null;
  sevenDayCoverage: string;
  /** The last six calendar weeks, oldest first. */
  energyWeeks: readonly EnergyWeek[];
}>;

export type ReviewInput = Readonly<{ days: readonly DaySummary[]; weights: readonly DailyWeight[]; steps: StepEnergy; summary: ModelSummary; settings: Settings }>;

const monday = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
const earlier = (a: string, b: string) => (a < b ? a : b);

/** The weekly review for the review date of `summary`. */
export function weeklyReview({ days, weights, steps, summary, settings }: ReviewInput): WeeklyReview {
  const review = summary.reviewDate;
  const closed = summary.closedThrough;
  const between = <T extends { day: string }>(list: readonly T[], from: string, to: string) => list.filter((one) => one.day >= from && one.day <= to);
  const complete = (from: string, to: string) => between(days, from, to).filter((day) => day.status === "Complete");
  const byDay = new Map(days.map((day) => [day.day, day]));
  const start = monday(review);

  const thisWeek = complete(start, review);
  const weekWeights = between(weights, start, review);
  const week: WeekDay[] = Array.from({ length: 7 }, (_, offset) => {
    const day = addDays(start, offset);
    const summaryDay = byDay.get(day);
    const status = day > review ? "Not due" : !summaryDay ? "No log" : summaryDay.status === "Unknown" ? "Unconfirmed" : summaryDay.status;
    return { day, status, kcal: day > review || !summaryDay ? "" : `${grouped(summaryDay.kcal)} kcal` };
  });

  const weeks: ReviewWeek[] = Array.from({ length: 12 }, (_, index) => {
    const from = addDays(start, -7 * index);
    const to = earlier(addDays(from, 6), review);
    const done = complete(from, to);
    const average = (pick: (day: DaySummary) => number) => (done.length ? mean(done.map(pick)) : null);
    const kcal = average((day) => day.kcal);
    const inWeek = between(weights, from, to);
    const halfRanges = done.map((day) => (day.check === "Ready" ? ((day.high.kcal as number) - (day.low.kcal as number)) / 2 : null));
    return {
      start: from, completeDays: done.length, kcal, vsTarget: kcal === null ? null : kcal - settings.calorieTarget,
      protein: average((day) => day.protein), carbs: average((day) => day.carbs), fat: average((day) => day.fat),
      weight: mean(inWeek.map((one) => one.kg)), weightDays: inWeek.length,
      kcalRange: done.length === 0 ? null : halfRanges.includes(null) ? "Review" : (halfRanges as number[]).reduce((sum, value) => sum + value, 0) / done.length
    };
  });

  const usable = (from: string, to: string) => between(steps.days, from, to).filter((day) => day.balance !== null);
  const energyWeeks: EnergyWeek[] = Array.from({ length: 6 }, (_, index) => {
    const from = addDays(start, -7 * (5 - index));
    const last = earlier(addDays(from, 6), closed);
    const first = summary.start !== null && summary.start > from ? summary.start : from;
    const possible = summary.start === null ? 0 : Math.max(0, daysBetween(first, last) + 1);
    const used = usable(from, last);
    const food = used.length ? used.reduce((sum, day) => sum + (day.loggedKcal as number), 0) : null;
    const energyOut = used.length ? -used.reduce((sum, day) => sum + (day.totalKcal as number), 0) : null;
    const net = food === null || energyOut === null ? null : food + energyOut;
    const coverage = possible === 0 ? "Outside history" : `${used.length}/${possible}`;
    const assessment = from > closed ? "Outside history"
      : net === null ? "No usable days"
      : summary.start !== null && from < summary.start ? "Start of record"
      : addDays(from, 6) > closed ? "Week to date"
      : coverage === "7/7" ? "Covered"
      : "Partial evidence";
    return { start: from, coverage, food, energyOut, net, assessment };
  });

  const sevenDays = usable(addDays(closed, -6), closed);
  const lastWeek = energyWeeks[energyWeeks.length - 1];
  return {
    intakeDays: between(days, start, review).length,
    completeDays: thisWeek.length,
    kcal: mean(thisWeek.map((day) => day.kcal)),
    protein: mean(thisWeek.map((day) => day.protein)),
    weight: mean(weekWeights.map((one) => one.kg)),
    weightDays: weekWeights.length,
    completeText: `${thisWeek.length} marked complete`,
    week, weeks,
    weekNet: lastWeek.net,
    weekCoverage: lastWeek.coverage,
    sevenDayNet: sevenDays.length ? sevenDays.reduce((sum, day) => sum + (day.balance as number), 0) : null,
    sevenDayCoverage: `${sevenDays.length}/7 days`,
    energyWeeks
  };
}
