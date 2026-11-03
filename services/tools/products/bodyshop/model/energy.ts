import { addDays, type CheckIn, type DayStatus, type DaySummary, daysBetween } from "../domain.js";
import type { Settings } from "../settings.js";
import type { ModelDay, ModelResult } from "./engine.js";
import { mean } from "./stats.js";
import { dayLabel, fixed, grouped, signed, toMultiple } from "./text.js";

/** An estimated gap day inside the current model window. An assumption for the model, not recorded food. */
export type InferredDay = Readonly<{ day: string; kcal: number; low: number; high: number; basis: "Partial log + estimate" | "No food log; estimate" }>;

/** One row of the window comparison: mean modeled intake, weight slope, and the expenditure they imply. */
export type WindowFit = Readonly<{ intake: number | null; weeklySlope: number | null; expenditure: number | null }>;

/** The maintenance decision view (sheet "Energy"). Shown numbers exist only while the model shows an estimate. */
export type EnergyView = Readonly<{
  /** The header line: accepted date, state, and interpretation. */
  headline: string;
  /** The working maintenance, rounded to 50 kcal, or "Not ready". */
  maintenance: string;
  target: string;
  /** The recent complete-day intake, or "Not enough complete days". */
  recentIntake: string;
  recentNote: string;
  /** The 21-day weight slope as kg per week, or "Not ready". */
  weightTrend: string;
  stressRange: string;
  /** What to do with the calorie target. The model never changes it. */
  decision: string;
  slopes: string;
  /** The accepted 21-day fit, the 14-day fit, and the up-to-28-day fit, all ending on the last accepted day. */
  accepted: WindowFit;
  fit14: WindowFit;
  fit28: WindowFit;
  fit28Label: string;
  windowCheck: string;
  /** Half the width of the window's intake range, and the core model allowance, on the last accepted day. */
  intakeHalfWidth: number | null;
  modelAllowance: number | null;
  candidateLow: number | null;
  candidateHigh: number | null;
  closedThrough: string;
  /** The estimated gap days of the current model window. */
  inferredDays: readonly InferredDay[];
}>;

function windowMean(rows: readonly ModelDay[], stop: string, length: number): number | null {
  const first = rows.find((row) => row.day >= addDays(stop, -(length - 1)) && row.day <= stop && row.weight.actual !== null);
  if (!first) return null;
  return mean(rows.filter((row) => row.day >= first.day && row.day <= stop && row.intake.modeled !== null).map((row) => row.intake.modeled as number));
}

/** The maintenance decision built from one model run. */
export function energyView({ rows, summary }: ModelResult, settings: Settings): EnergyView {
  const mid = summary.tdeeMid;
  const shown = mid !== null;
  const accepted = summary.lastAccepted === null ? undefined : rows.find((row) => row.day === summary.lastAccepted);
  const at = <T>(pick: (row: ModelDay) => T) => (shown && accepted ? pick(accepted) : null);
  const weekly = (intake: number | null, expenditure: number | null) => (intake === null || expenditure === null ? null : ((intake - expenditure) * 7) / settings.energyDensity);
  const acceptedFit: WindowFit = { intake: at((row) => row.engine.meanIntake), weeklySlope: at((row) => (row.engine.slope === null ? null : 7 * row.engine.slope)), expenditure: shown ? summary.acceptedCandidate : null };
  const intake14 = shown && summary.fit14 !== null ? windowMean(rows, summary.lastAccepted as string, 14) : null;
  const intake28 = shown && summary.fit28 !== null ? windowMean(rows, summary.lastAccepted as string, 28) : null;
  const fit14: WindowFit = { intake: intake14, weeklySlope: weekly(intake14, shown ? summary.fit14 : null), expenditure: shown ? summary.fit14 : null };
  const fit28: WindowFit = { intake: intake28, weeklySlope: weekly(intake28, shown ? summary.fit28 : null), expenditure: shown ? summary.fit28 : null };
  const targetText = grouped(settings.calorieTarget);

  const decision = !shown
    ? `Keep the existing calorie target. Model status: ${summary.state}. More complete intake and actual weigh-ins are needed.`
    : summary.interpretation === "Window-sensitive"
      ? `KEEP ${targetText} kcal target. Maintenance is sensitive to the time window; do not cut the target from this estimate. Review after seven additional complete days with actual weigh-ins.`
      : `KEEP ${targetText} kcal target. No automatic target change is made. Review sustained weight change, logging coverage, activity and recovery together.`;
  const slope21 = acceptedFit.weeklySlope;
  const slope14 = fit14.weeklySlope;

  const window = summary.windowStart === null ? [] : rows.filter((row) => row.day >= (summary.windowStart as string) && row.day <= summary.closedThrough);
  const inferredDays = window.filter((row) => row.intake.modeledBasis === "Estimated gap day").slice(0, 21).map((row) => ({
    day: row.day, kcal: row.intake.modeled as number, low: row.intake.modeledLow as number, high: row.intake.modeledHigh as number,
    basis: row.intake.entries > 0 ? "Partial log + estimate" as const : "No food log; estimate" as const
  }));

  return {
    headline: `Accepted evidence through ${summary.lastAccepted === null ? "not ready" : dayLabel(summary.lastAccepted, "dd mmm yyyy")} | ${summary.state} / ${summary.interpretation} | Targets unchanged`,
    maintenance: shown ? `~${grouped(Number(fixed(mid / 50)) * 50)} kcal/day` : "Not ready",
    target: `${targetText} kcal/day`,
    recentIntake: summary.recentCompleteDays >= settings.reviewMinCompleteDays && summary.recentIntake !== null ? `${grouped(summary.recentIntake)} kcal/day` : "Not enough complete days",
    recentNote: `Last 7 closed days: ${summary.recentCompleteDays} complete / estimates excluded`,
    weightTrend: slope21 === null ? "Not ready" : `${signed(slope21)} kg/week`,
    stressRange: shown
      ? `Stress range: ${grouped(toMultiple(summary.tdeeLow as number, 50, "floor"))} - ${grouped(toMultiple(summary.tdeeHigh as number, 50, "ceil"))} kcal/day | subjective, not a confidence interval`
      : "Stress range unavailable until the model has sufficient evidence",
    decision,
    slopes: slope21 !== null && slope14 !== null
      ? `Weight slopes: 21 days ${signed(slope21)} kg/week; 14 days ${signed(slope14)} kg/week. This is trend evidence, not a fat-loss measurement.`
      : "Recent weight evidence insufficient for a trend comparison.",
    accepted: acceptedFit, fit14, fit28,
    fit28Label: summary.lastAccepted !== null && summary.start !== null ? `Up to 28 days (${Math.min(28, daysBetween(summary.start, summary.lastAccepted) + 1)} available)` : "Up-to-28-day sensitivity",
    windowCheck: summary.deviation !== null
      ? `Window check: ${summary.interpretation}. Largest deviation from the working estimate: ${grouped(summary.deviation)} kcal/day. These fits overlap; they are not independent evidence.`
      : "Window comparison is not ready.",
    intakeHalfWidth: at((row) => (row.engine.meanIntakeHigh === null || row.engine.meanIntakeLow === null ? null : (row.engine.meanIntakeHigh - row.engine.meanIntakeLow) / 2)),
    modelAllowance: at((row) => row.engine.uncertainty),
    candidateLow: at((row) => row.engine.candidateLow),
    candidateHigh: at((row) => row.engine.candidateHigh),
    closedThrough: dayLabel(summary.closedThrough, "dd mmm yyyy"),
    inferredDays
  };
}

/** The body values the step estimate needs. They are rough assumptions, not calibrated to a person's gait. */
export type StepProfile = Readonly<{
  heightCm: number;
  /** Step length as a share of height, such as 0.414. */
  strideRatio: number;
  /** Net level-ground walking cost in kcal per kg per km, such as 0.5. */
  walkingCost: number;
  /** Age and sex are optional. Without both, no resting estimate is shown. */
  age: number | null;
  sex: "Male" | "Female" | null;
}>;

export type StepStatus = DayStatus | "No steps reported" | "Conflicting step reports";

/** One day of the step scenario (sheet "Step energy", columns A to M and Q to V). */
export type StepDay = Readonly<{
  day: string;
  /** The reported steps. Missing when no count or when reports conflict. */
  steps: number | null;
  /** The latest measured weight, at most the maximum internal weight gap old. */
  kg: number | null;
  distanceKm: number | null;
  /** Estimated net walking energy. */
  walkingKcal: number | null;
  /** The non-walking base: working maintenance minus the mean walking energy of the accepted window. */
  baseKcal: number | null;
  /** The day's scenario total: base plus walking. A rescaled scenario, not a measurement. */
  totalKcal: number | null;
  loggedKcal: number | null;
  /** Logged intake minus the scenario total, on closed days reported Complete in Check-ins. Positive is a surplus. */
  balance: number | null;
  status: StepStatus;
  /** The optional Mifflin resting equation, and the part of the base left after it. */
  restingKcal: number | null;
  remainingKcal: number | null;
  /** Closed-day complete intake as the model uses it, and that intake minus the scenario total. */
  completeIntake: number | null;
  scenarioBalance: number | null;
}>;

/** The step scenario (sheet "Step energy"). */
export type StepEnergy = Readonly<{
  /** The resting equation at the latest weight, when age and sex are given and the weight is fresh. */
  resting: number | null;
  maintenance: number | null;
  /** The mean walking energy and the count of usable step days in the accepted model window. */
  meanWalking: number | null;
  stepDays: number;
  /** Maintenance minus mean walking, only with enough step days. */
  base: number | null;
  status: "Scenario only" | "Model not ready" | "Review baseline" | "Usable step history sparse";
  /** The latest day with reported steps. */
  latest: StepDay | null;
  restingText: string;
  calibrationText: string;
  /** The calibration days (at least 90) ending on the review date. */
  days: readonly StepDay[];
}>;

const restingEquation = (kg: number, profile: StepProfile) =>
  profile.age !== null && profile.age >= 18 && profile.sex !== null ? 10 * kg + 6.25 * profile.heightCm - 5 * profile.age + (profile.sex === "Male" ? 5 : -161) : null;

function reportedSteps(checkIns: readonly CheckIn[], day: string): { steps: number | null; conflict: boolean } {
  const values = new Set(checkIns.filter((one) => one.day === day && one.steps !== null && one.steps >= 0).map((one) => one.steps as number));
  return { steps: values.size === 1 ? [...values][0] : null, conflict: values.size > 1 };
}

/**
 * The step-based daily expenditure scenario. `viewDays` is the dashboard history window. The table covers at
 * least 90 and at most 180 days ending on the review date.
 */
export function stepEnergy({ rows, summary }: ModelResult, days: readonly DaySummary[], checkIns: readonly CheckIn[], settings: Settings, profile: StepProfile, viewDays: number): StepEnergy {
  const length = Math.max(90, Math.min(180, viewDays));
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const logged = new Map(days.map((day) => [day.day, day.kcal]));
  const firstCheckIn = new Map<string, CheckIn>();
  for (const one of checkIns) if (!firstCheckIn.has(one.day)) firstCheckIn.set(one.day, one);

  const base = (rowsWithWalking: readonly { day: string; walking: number | null }[]) => {
    const from = summary.acceptedWindowStart, to = summary.lastAccepted;
    const used = from === null || to === null ? [] : rowsWithWalking.filter((row) => row.day >= from && row.day <= to && row.walking !== null).map((row) => row.walking as number);
    return { meanWalking: from === null ? null : mean(used), stepDays: used.length };
  };

  const walking = Array.from({ length }, (_, offset) => {
    const day = addDays(summary.reviewDate, offset - length + 1);
    const { steps, conflict } = reportedSteps(checkIns, day);
    const last = byDay.get(day)?.weight.lastActual ?? null;
    const kg = last !== null && daysBetween(last, day) <= settings.maxWeightGap ? (byDay.get(last)?.weight.actual ?? null) : null;
    const distanceKm = steps === null ? null : (steps * profile.heightCm * profile.strideRatio) / 100000;
    const walkingKcal = distanceKm === null || kg === null ? null : distanceKm * kg * profile.walkingCost;
    return { day, steps, conflict, kg, distanceKm, walking: walkingKcal };
  });

  const maintenance = summary.tdeeMid;
  const { meanWalking, stepDays } = base(walking);
  const needed = Math.max(7, toMultiple(settings.minCoverage * (summary.acceptedWindowDays ?? 0), 1, "ceil"));
  const baseKcal = maintenance !== null && meanWalking !== null && summary.acceptedWindowDays !== null && stepDays >= needed && maintenance > meanWalking ? maintenance - meanWalking : null;
  const status = baseKcal !== null ? "Scenario only" : maintenance === null ? "Model not ready" : meanWalking !== null && meanWalking >= maintenance ? "Review baseline" : "Usable step history sparse";

  const stepDaysList: StepDay[] = walking.map(({ day, steps, conflict, kg, distanceKm, walking: walkingKcal }) => {
    const dayBase = walkingKcal !== null && baseKcal !== null ? baseKcal : null;
    const totalKcal = walkingKcal !== null && dayBase !== null ? walkingKcal + dayBase : null;
    const loggedKcal = logged.get(day) ?? null;
    const reported = firstCheckIn.get(day)?.reported ?? null;
    const stepStatus: StepStatus = steps === null ? (conflict ? "Conflicting step reports" : "No steps reported") : reported ?? "Unknown";
    const restingKcal = dayBase !== null && kg !== null ? restingEquation(kg, profile) : null;
    const row = byDay.get(day);
    const completeIntake = row && day <= summary.closedThrough && row.intake.eligible ? row.intake.kcal : null;
    return {
      day, steps, kg, distanceKm, walkingKcal, baseKcal: dayBase, totalKcal, loggedKcal,
      balance: day <= summary.closedThrough && totalKcal !== null && loggedKcal !== null && stepStatus === "Complete" ? loggedKcal - totalKcal : null,
      status: stepStatus, restingKcal,
      remainingKcal: dayBase !== null && restingKcal !== null && dayBase >= restingKcal ? dayBase - restingKcal : null,
      completeIntake, scenarioBalance: totalKcal !== null && completeIntake !== null ? completeIntake - totalKcal : null
    };
  });

  const resting = summary.latestWeight !== null && (summary.weightAge ?? Number.POSITIVE_INFINITY) <= settings.freshDays ? restingEquation(summary.latestWeight, profile) : null;
  const latest = [...stepDaysList].reverse().find((row) => row.steps !== null) ?? null;
  return {
    resting, maintenance, meanWalking, stepDays, base: baseKcal, status, latest,
    restingText: resting === null ? "Not estimated" : `${grouped(resting)} kcal | equation only`,
    calibrationText: summary.acceptedWindowDays === null ? "No accepted window" : `${stepDays} / ${summary.acceptedWindowDays} usable calibration days`,
    days: stepDaysList
  };
}

const TRAINING = ["Gym", "Other"];
const TRAINING_STATUS = ["Gym", "Other", "None"];

/** One reported day of the activity view (sheet "UI data", columns J to Q). Missing reports stay missing. */
export type ActivityDay = Readonly<{
  day: string;
  steps: number | null;
  sleep: number | null;
  hunger: number | null;
  fatigue: number | null;
  recovery: number | null;
  /** 1 when training was reported, 0 when None was reported, null when nothing was reported. */
  training: 0 | 1 | null;
  trainingStatus: "Training reported" | "No training reported" | "Not logged";
}>;

/** One Monday-to-Sunday week (sheet "UI data", columns A to H). Counts stop at the review date. */
export type ActivityWeek = Readonly<{
  start: string;
  complete: number;
  partial: number;
  unverified: number;
  noLog: number;
  completeProtein: number | null;
  /** Check-in rows with Gym or Other. Null when no training status was reported in the week. */
  trainingDays: number | null;
  trainingStatusDays: number;
}>;

/** The activity and recovery view (sheet "Activity"). */
export type ActivityView = Readonly<{
  days: readonly ActivityDay[];
  weeks: readonly ActivityWeek[];
  trainingDays: string;
  averageSteps: string;
  averageSleep: string;
  trainingCoverage: string;
  stepReports: string;
  sleepReports: string;
  stepSummary: string;
}>;

const monday = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

/** Averages the values of one day. `keep` decides which reports count; `present` decides whether the day has any. */
function dayMean(values: readonly (number | null)[], present: (value: number) => boolean, keep: (value: number) => boolean): number | null {
  const known = values.filter((value): value is number => value !== null);
  if (!known.some(present)) return null;
  return mean(known.filter(keep));
}

/** The reported activity of the `viewDays` days ending on `reviewDate`, and the last twelve weeks. */
export function activityView(days: readonly DaySummary[], checkIns: readonly CheckIn[], reviewDate: string, viewDays: number): ActivityView {
  const reportsOn = (day: string) => checkIns.filter((one) => one.day === day);
  const rating = (value: number) => value >= 1 && value <= 5;
  const activityDays: ActivityDay[] = Array.from({ length: viewDays }, (_, offset) => {
    const day = addDays(reviewDate, offset - viewDays + 1);
    const reports = reportsOn(day);
    const statusCount = reports.filter((one) => TRAINING_STATUS.includes(one.training)).length;
    const training = statusCount === 0 ? null : (Math.min(1, reports.filter((one) => TRAINING.includes(one.training)).length) as 0 | 1);
    return {
      day,
      steps: dayMean(reports.map((one) => one.steps), (value) => value >= 0, () => true),
      sleep: dayMean(reports.map((one) => one.sleep), (value) => value >= 0, () => true),
      hunger: dayMean(reports.map((one) => one.hunger), rating, rating),
      fatigue: dayMean(reports.map((one) => one.fatigue), rating, rating),
      recovery: dayMean(reports.map((one) => one.recovery), rating, rating),
      training,
      trainingStatus: training === null ? "Not logged" : training === 1 ? "Training reported" : "No training reported"
    };
  });

  const thisWeek = monday(reviewDate);
  const weeks: ActivityWeek[] = Array.from({ length: 12 }, (_, index) => {
    const start = addDays(thisWeek, -7 * (11 - index));
    const end = [addDays(start, 6), reviewDate].sort()[0];
    const inWeek = days.filter((day) => day.day >= start && day.day <= end);
    const complete = inWeek.filter((day) => day.status === "Complete").length;
    const partial = inWeek.filter((day) => day.status === "Partial").length;
    const unverified = Math.max(0, inWeek.filter((day) => day.entries > 0).length - complete - partial);
    const reports = checkIns.filter((one) => one.day >= start && one.day <= end);
    const trainingStatusDays = reports.filter((one) => TRAINING_STATUS.includes(one.training)).length;
    return {
      start, complete, partial, unverified,
      noLog: Math.max(0, Math.min(7, daysBetween(start, reviewDate) + 1) - complete - partial - unverified),
      completeProtein: mean(inWeek.filter((day) => day.status === "Complete").map((day) => day.protein)),
      trainingDays: trainingStatusDays === 0 ? null : reports.filter((one) => TRAINING.includes(one.training)).length,
      trainingStatusDays
    };
  });

  const numbers = (pick: (day: ActivityDay) => number | null) => activityDays.map(pick).filter((value): value is number => value !== null);
  const training = numbers((day) => day.training);
  const steps = numbers((day) => day.steps);
  const sleep = numbers((day) => day.sleep);
  const stepMean = mean(steps);
  return {
    days: activityDays, weeks,
    trainingDays: training.length === 0 ? "Not logged" : fixed(training.reduce((sum, value) => sum + value, 0)),
    averageSteps: stepMean === null ? "Not logged" : grouped(stepMean),
    averageSleep: sleep.length === 0 ? "Not logged" : `${fixed(mean(sleep) as number, 1)} h`,
    trainingCoverage: `${training.length} / ${viewDays} days`,
    stepReports: `${steps.length} day(s) with step reports`,
    sleepReports: `${sleep.length} night(s) with sleep reports`,
    stepSummary: `${dayLabel(addDays(reviewDate, -viewDays + 1), "d mmm")} to ${dayLabel(reviewDate, "d mmm yyyy")}  |  ${steps.length} reported days  |  avg ${stepMean === null ? "Not logged" : grouped(stepMean)} steps`
  };
}
