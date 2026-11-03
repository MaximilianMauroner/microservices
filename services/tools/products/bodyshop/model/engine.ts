import { addDays, type CheckIn, type DayStatus, type DaySummary, daysBetween, type WeightReading } from "../domain.js";
import type { Settings } from "../settings.js";
import { forecast, mean, sampleDeviation, slope, slopeError } from "./stats.js";
import { dailyMeanWeights, type WeightDay, weightTrend } from "./weight.js";

/** The expenditure model version these calculations reproduce. */
export const MODEL_VERSION = "BS-1.3.0";

export const INTAKE_BASES = [
  "Open logging day",
  "Complete log",
  "Estimated gap day",
  "Review calorie data",
  "Gap exceeds inference limit",
  "Insufficient reference days",
  "Review incomplete calorie data"
] as const;
/** How the model gets a day's calories: from a complete log, from a short-gap estimate, or not at all. */
export type IntakeBasis = (typeof INTAKE_BASES)[number];

/** The intake view of one calendar day (sheet "Model inputs", columns E to Y). */
export type IntakeDay = Readonly<{
  /** The food-log status of the day, or Missing when nothing was logged. */
  status: DayStatus | "Missing";
  /** Logged calories and their plausible range. Null when there is no log or the range is not known. */
  kcal: number | null;
  kcalLow: number | null;
  kcalHigh: number | null;
  /** True for a closed day with a complete log and a usable calorie range. Only these days count as observed intake. */
  eligible: boolean;
  /** Why the day is complete or not. */
  basis: string;
  entries: number;
  /** Closed days in a row without a complete log, up to this day. Null on the open logging day. */
  nonCompleteRun: number | null;
  /** Complete days in the reference window before this day, used to estimate a short gap. */
  referenceDays: number;
  /** The mean calories of those reference days, when there are enough of them. */
  referenceMean: number | null;
  /** The half-width of an estimated gap day: the larger of the uncertainty floor share and two standard deviations. */
  inferenceHalfWidth: number | null;
  /** The calories the model uses for the day, with their range. Logged on complete days, estimated on short gaps. */
  modeled: number | null;
  modeledLow: number | null;
  modeledHigh: number | null;
  modeledBasis: IntakeBasis;
  /** Running sums of the modeled calories since the first day. Null on the open logging day. */
  cumulative: number | null;
  cumulativeLow: number | null;
  cumulativeHigh: number | null;
}>;

export const GATES = [
  "Open logging day",
  "Building intake history",
  "Building weight history",
  "Building weight span",
  "Incomplete intake coverage",
  "Recent intake sparse",
  "Long weight gap",
  "Recent weigh-ins sparse",
  "Unresolved intake gap / data check",
  "Review: invalid candidate",
  "Review: unusual expenditure",
  "Review: rapid scale change",
  "Waiting for weigh-in",
  "Ready"
] as const;
/** The first evidence check that stops a refresh on a day, or Ready when all pass. */
export type Gate = (typeof GATES)[number];

export const ENGINE_STATES = ["Open day", "Review", "Building", "Stale", "Holding", "Updating"] as const;
/**
 * Building: not enough matched history. Updating: usable recent estimate. Holding: last valid estimate kept with
 * wider bounds. Stale or Review: current numbers are hidden. Open day: the current logging day.
 */
export type EngineState = (typeof ENGINE_STATES)[number];

/** The expenditure fit of one calendar day (sheet "Model engine"). Every window ends on this day. */
export type EngineDay = Readonly<{
  /** The first measured weight in the model window, so food and weight cover the same days. */
  windowStart: string;
  windowDays: number;
  /** Complete intake days in the window, and in the last seven days. */
  completeDays: number;
  recentCompleteDays: number;
  /** Measured weight days in the window, and the days between the first and last of them. */
  weightDays: number;
  weightSpan: number;
  /** Complete intake days as a share of window days. Logging coverage, not confidence. */
  coverage: number;
  /** The mean modeled calories over the window, only when every window day has modeled calories. */
  meanIntake: number | null;
  meanIntakeLow: number | null;
  meanIntakeHigh: number | null;
  /** The summed half-widths of estimated gap days per window day. Diagnostic only. */
  inferenceAllowance: number | null;
  /** The least-squares slope of measured weight, in kg per day, and its standard error. */
  slope: number | null;
  slopeError: number | null;
  /** The half-width added to each side of the candidate range, in kcal per day. */
  uncertainty: number | null;
  /** This day's raw expenditure: mean intake minus weight slope times the energy equivalent. */
  candidate: number | null;
  candidateLow: number | null;
  candidateHigh: number | null;
  /** The longest gap between measured weights inside the window. */
  maxGap: number;
  refresh: boolean;
  gate: Gate;
  /** The latest day whose candidate was accepted. */
  lastAccepted: string | null;
  /** The smoothed accepted expenditure and its range. Kept unchanged on days without a refresh. */
  accepted: number | null;
  acceptedLow: number | null;
  acceptedHigh: number | null;
  state: EngineState;
  /** The expenditure shown for the day: accepted values while Updating or Holding, with a range that widens with age. */
  displayed: number | null;
  displayedLow: number | null;
  displayedHigh: number | null;
  /** The smoothing weight given to this day's candidate on a refresh. */
  alpha: number | null;
  /** Measured weight days in the recent actual-weight window. */
  recentWeightDays: number;
  /** How much the candidate moves when the newest measured weight is left out, in kcal per day. */
  lastReadingSensitivity: number | null;
  /** The timing model: slopes of cumulative modeled calories over the measured days. Not active. */
  timingIntake: number | null;
  timingIntakeLow: number | null;
  timingIntakeHigh: number | null;
  /** The timing model's fitted weight on this day. Not active. */
  fittedEndWeight: number | null;
  /** The timing model's expenditure. Not active, kept for comparison. */
  timingCandidate: number | null;
}>;

export type ModelDay = Readonly<{ day: string; weight: WeightDay; intake: IntakeDay; engine: EngineDay }>;

/** The current numbers of the expenditure model (sheet "Model"). Ranges are subjective scenarios, not confidence intervals. */
export type ModelSummary = Readonly<{
  /** bs_state: the model state on the last closed day. Building when there is no closed day. */
  state: EngineState;
  /** bs_tdee_low, bs_tdee_mid, bs_tdee_high: expenditure in kcal per day, shown only while Updating or Holding. */
  tdeeLow: number | null;
  tdeeMid: number | null;
  tdeeHigh: number | null;
  /** bs_balance_low and bs_balance_high: recent complete-day intake minus expenditure. Negative is a deficit. Only while Updating. */
  balanceLow: number | null;
  balanceMid: number | null;
  balanceHigh: number | null;
  /** The balance range as kg per week through the energy equivalent. A rough scenario, not a fat-loss prediction. */
  weeklyChangeLow: number | null;
  weeklyChangeHigh: number | null;
  lastAccepted: string | null;
  /** bs_asof: the model uses closed days through this date. The current logging day is excluded. */
  closedThrough: string;
  latestWeighIn: string | null;
  latestWeight: number | null;
  /** bs_trend: the trend weight on the review date, when the latest measurement is fresh. */
  trend: number | null;
  startWeight: number | null;
  windowStart: string | null;
  windowDays: number;
  completeDays: number;
  weightDays: number;
  weightSpan: number;
  coverage: number;
  recentCompleteDays: number;
  /** The gate on the last closed day, or "No closed-day history". */
  gate: Gate | "No closed-day history";
  /** Days from the last accepted update to the last closed day. */
  acceptedAge: number | null;
  /** Complete days in the window whose basis is still an unconfirmed legacy auto-completion. */
  legacyCompletions: number;
  /** bs_start: the first day with food or a weight record. */
  start: string | null;
  version: typeof MODEL_VERSION;
  /** Balance if you eat exactly at the calorie target. A scenario, only while Updating. */
  targetBalanceLow: number | null;
  targetBalanceHigh: number | null;
  /** The mean intake of complete days among the last seven closed days, with its range. */
  recentIntakeLow: number | null;
  recentIntake: number | null;
  recentIntakeHigh: number | null;
  /** bs_review_date: the day under review. It is the current logging day. */
  reviewDate: string;
  /** bs_model_row: the index in `rows` of the last closed day, or null. */
  modelIndex: number | null;
  /** The unsmoothed candidate on the last accepted day. */
  acceptedCandidate: number | null;
  /** Candidates of a 14-day and an up-to-28-day window ending on the last accepted day, when their gates pass. */
  fit14: number | null;
  fit28: number | null;
  /** The largest distance of those candidates from the centre. The stress range is at least this wide on each side. */
  deviation: number | null;
  /** The greater of 300 kcal per day and 10 % of the centre. */
  warningThreshold: number | null;
  interpretation: "Window-sensitive" | "Limited history" | "Consistent windows" | EngineState;
  /** Days since the latest measured weight, on the review date. */
  weightAge: number | null;
  acceptedWindowStart: string | null;
  acceptedWindowDays: number | null;
  completeDaysAvailable: number;
  weighInDaysAvailable: number;
  /** The current window split into complete, estimated, and unresolved days. */
  estimatedGapDays: number;
  unresolvedDays: number;
  automaticCompleteDays: number;
  recordedCompleteDays: number;
  /** The window's mean modeled calories, and the mean of its complete logs only. */
  meanModeledIntake: number | null;
  completeLogMean: number | null;
  recentWeightDays: number;
  /** The candidate on the last closed day. It may differ from the accepted centre while Holding. */
  candidate: number | null;
  timingCandidate: number | null;
  lastReadingSensitivity: number | null;
  /** The evidence minimums as the sheet states them. */
  notes: Readonly<{ intake: string; weights: string; span: string }>;
}>;

export type ModelResult = Readonly<{ rows: readonly ModelDay[]; summary: ModelSummary }>;

export type ModelInput = Readonly<{
  days: readonly DaySummary[];
  weights: readonly WeightReading[];
  checkIns: readonly CheckIn[];
  settings: Settings;
  /** The current logging day. It is the review date; the model uses closed days before it. */
  asOf: string;
}>;

const LEGACY_BASIS = "Legacy auto-complete; not user-confirmed";

/** Runs expenditure model BS-1.3.0 over every calendar day from the first record to `asOf`. */
export function runModel({ days, weights, checkIns, settings, asOf }: ModelInput): ModelResult {
  const reviewDate = asOf;
  const closedThrough = addDays(asOf, -1);
  const dates = [...days.map((day) => day.day), ...weights.map((weight) => weight.day)].filter((day) => day <= reviewDate).sort();
  const start = dates[0] ?? null;
  const calendar = start ? Array.from({ length: daysBetween(start, reviewDate) + 1 }, (_, index) => addDays(start, index)) : [];
  const weightRows = weightTrend(calendar, dailyMeanWeights(weights), settings, reviewDate);
  const intake = intakeDays(calendar, days, closedThrough, settings);
  const engine = engineDays(calendar, weightRows, intake, closedThrough, settings);
  const rows = calendar.map((day, index) => ({ day, weight: weightRows[index], intake: intake[index], engine: engine[index] }));
  return { rows, summary: summarize(rows, checkIns, settings, { reviewDate, closedThrough, start }) };
}

function intakeDays(calendar: readonly string[], days: readonly DaySummary[], closedThrough: string, settings: Settings): IntakeDay[] {
  const byDay = new Map(days.map((day) => [day.day, day]));
  const rows: IntakeDay[] = [];
  for (const [index, day] of calendar.entries()) {
    const summary = byDay.get(day);
    const status = summary?.status ?? "Missing";
    const kcal = summary ? summary.kcal : null;
    const kcalLow = summary?.low.kcal ?? null;
    const kcalHigh = summary?.high.kcal ?? null;
    const entries = summary?.entries ?? 0;
    const closed = day <= closedThrough;
    const rangeValid = kcal !== null && kcalLow !== null && kcalHigh !== null && kcalLow >= 0 && kcalLow <= kcal && kcal <= kcalHigh;
    const eligible = closed && status === "Complete" && rangeValid && (kcal as number) >= 0 && entries > 0;
    const previous = rows[index - 1];
    const nonCompleteRun = !closed ? null : eligible ? 0 : (previous?.nonCompleteRun ?? 0) + 1;

    const reference = rows.slice(Math.max(0, Math.ceil(index - settings.inferenceWindow)), index).filter((row) => row.eligible).map((row) => row.kcal as number);
    const referenceMean = reference.length < settings.inferenceMinDays ? null : mean(reference);
    const inferenceHalfWidth = referenceMean === null ? null : Math.max(settings.inferenceFloor * referenceMean, 2 * (sampleDeviation(reference) ?? 0));

    let modeled: number | null = null;
    if (closed && eligible) modeled = kcal;
    else if (closed && status !== "Complete" && (nonCompleteRun as number) <= settings.inferenceMaxConsecutive && referenceMean !== null && (entries === 0 || rangeValid)) {
      modeled = Math.max(kcal ?? 0, referenceMean);
    }
    const estimated = modeled !== null && !eligible;
    const modeledLow = modeled === null ? null : eligible ? kcalLow : Math.max(0, kcalLow ?? 0, modeled - (inferenceHalfWidth as number));
    const modeledHigh = modeled === null ? null : eligible ? kcalHigh : Math.max(kcalHigh ?? 0, modeled + (inferenceHalfWidth as number));
    const modeledBasis: IntakeBasis = !closed ? "Open logging day"
      : eligible ? "Complete log"
      : estimated ? "Estimated gap day"
      : status === "Complete" ? "Review calorie data"
      : (nonCompleteRun as number) > settings.inferenceMaxConsecutive ? "Gap exceeds inference limit"
      : reference.length < settings.inferenceMinDays ? "Insufficient reference days"
      : "Review incomplete calorie data";
    const running = (value: number | null | undefined, add: number | null) => (closed ? (value ?? 0) + (add ?? 0) : null);
    rows.push({
      status, kcal, kcalLow, kcalHigh, eligible, basis: summary?.basis ?? "No food log", entries, nonCompleteRun,
      referenceDays: reference.length, referenceMean, inferenceHalfWidth, modeled, modeledLow, modeledHigh, modeledBasis,
      cumulative: running(previous?.cumulative, modeled),
      cumulativeLow: running(previous?.cumulativeLow, modeledLow),
      cumulativeHigh: running(previous?.cumulativeHigh, modeledHigh)
    });
  }
  return rows;
}

function engineDays(calendar: readonly string[], weight: readonly WeightDay[], intake: readonly IntakeDay[], closedThrough: string, settings: Settings): EngineDay[] {
  const density = settings.energyDensity;
  const rows: EngineDay[] = [];
  const between = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, offset) => from + offset);
  const count = (from: number, to: number, test: (index: number) => boolean) => between(Math.max(0, from), to).filter(test).length;
  const measured = (index: number) => weight[index].actual !== null;

  for (const [index, day] of calendar.entries()) {
    const earliest = Math.max(0, Math.ceil(index - settings.modelWindow + 1));
    const firstWeight = between(earliest, index).find(measured);
    const from = firstWeight ?? earliest;
    const window = between(from, index);
    const points = window.filter(measured);
    const xs = points;
    const ys = points.map((point) => weight[point].actual as number);
    const windowDays = index - from + 1;
    const completeDays = count(from, index, (at) => intake[at].eligible);
    const recentCompleteDays = count(index - 6, index, (at) => intake[at].eligible);
    const weightDays = points.length;
    const weightSpan = weightDays < 2 ? 0 : points[points.length - 1] - from;
    const coverage = completeDays / windowDays;
    const modeled = window.map((at) => intake[at]);
    const fullIntake = modeled.every((row) => row.modeled !== null);
    const meanIntake = fullIntake ? mean(modeled.map((row) => row.modeled as number)) : null;
    const meanIntakeLow = fullIntake ? mean(modeled.map((row) => row.modeledLow as number)) : null;
    const meanIntakeHigh = fullIntake ? mean(modeled.map((row) => row.modeledHigh as number)) : null;
    const inferenceAllowance = fullIntake ? modeled.filter((row) => row.modeledBasis === "Estimated gap day").reduce((sum, row) => sum + (row.inferenceHalfWidth ?? 0), 0) / windowDays : null;
    const fittedSlope = weightDays < 2 ? null : slope(ys, xs);
    const fittedError = weightDays < 3 ? null : slopeError(ys, xs);
    const candidate = meanIntake !== null && fittedSlope !== null ? meanIntake - fittedSlope * density : null;

    const lastActual = weight[index].lastActual;
    const earlier = points.filter((point) => lastActual !== null && calendar[point] < lastActual);
    const earlierSlope = slope(earlier.map((point) => weight[point].actual as number), earlier);
    const lastReadingSensitivity = candidate === null || weightDays < 4 || earlierSlope === null ? null : density * Math.abs((fittedSlope as number) - earlierSlope);
    const uncertainty = fittedError === null ? null
      : Math.max(settings.errorFloor, settings.slopeMultiplier * fittedError * density, lastReadingSensitivity ?? 0) + Math.abs(fittedSlope as number) * density * settings.energyUncertainty;
    const candidateLow = uncertainty === null || meanIntakeLow === null ? null : Math.max(0, meanIntakeLow - (fittedSlope as number) * density - uncertainty);
    const candidateHigh = uncertainty === null || meanIntakeHigh === null ? null : meanIntakeHigh - (fittedSlope as number) * density + uncertainty;
    const maxGap = weightDays < 2 ? 0 : Math.max(0, ...between(from + 1, index).map((at) => weight[at].gap ?? 0));
    const recentWeightDays = count(index - settings.recentWeightWindow + 1, index, measured);

    const gate: Gate = day > closedThrough ? "Open logging day"
      : completeDays < settings.minCompleteDays ? "Building intake history"
      : weightDays < settings.minWeightDays ? "Building weight history"
      : weightSpan < settings.minWeightSpan ? "Building weight span"
      : coverage < settings.minCoverage ? "Incomplete intake coverage"
      : recentCompleteDays < settings.minRecentComplete ? "Recent intake sparse"
      : maxGap > settings.maxWeightGap ? "Long weight gap"
      : recentWeightDays < settings.minRecentWeights ? "Recent weigh-ins sparse"
      : meanIntake === null ? "Unresolved intake gap / data check"
      : candidate === null || candidateLow === null || candidateHigh === null ? "Review: invalid candidate"
      : candidate < settings.expenditureMin || candidate > settings.expenditureMax ? "Review: unusual expenditure"
      : fittedSlope !== null && ys.length > 0 && (Math.abs(fittedSlope) * 7) / Math.max(...ys) > settings.rapidTrendReview ? "Review: rapid scale change"
      : weight[index].actual === null ? "Waiting for weigh-in"
      : "Ready";
    const refresh = gate === "Ready";

    const previous = rows[index - 1];
    const priorAccepted = previous?.lastAccepted ?? null;
    const alpha = !refresh ? null
      : priorAccepted === null || daysBetween(priorAccepted, day) > settings.staleDays ? 1
      : 1 - (1 - settings.expenditureAlpha) ** count(calendar.indexOf(priorAccepted) + 1, index, measured);
    const smooth = (prior: number | null | undefined, value: number) => (1 - (alpha as number)) * (prior ?? 0) + (alpha as number) * value;
    const lastAccepted = refresh ? day : priorAccepted;
    const accepted = refresh ? (alpha === 1 ? candidate : smooth(previous?.accepted, candidate as number)) : previous?.accepted ?? null;
    const acceptedLow = refresh ? (alpha === 1 ? candidateLow : Math.min(smooth(previous?.acceptedLow, candidateLow as number), candidateLow as number)) : previous?.acceptedLow ?? null;
    const acceptedHigh = refresh ? (alpha === 1 ? candidateHigh : Math.max(smooth(previous?.acceptedHigh, candidateHigh as number), candidateHigh as number)) : previous?.acceptedHigh ?? null;

    const age = lastAccepted === null ? 0 : daysBetween(lastAccepted, day);
    const state: EngineState = day > closedThrough ? "Open day"
      : gate.startsWith("Review") ? "Review"
      : accepted === null ? "Building"
      : age > settings.staleDays ? "Stale"
      : age > 0 || gate !== "Ready" ? "Holding"
      : "Updating";
    const shown = state === "Updating" || state === "Holding";
    const widening = Math.max(0, age - settings.freshDays) * settings.holdingGrowth;

    const cumulative = (pick: (row: IntakeDay) => number | null) => points.map((point) => pick(intake[point]) ?? 0);
    const timing = (pick: (row: IntakeDay) => number | null) => (meanIntake === null || weightDays < 2 ? null : slope(cumulative(pick), xs));
    const timingIntake = timing((row) => row.cumulative);
    const own = intake[index].cumulative ?? 0;
    const eaten = cumulative((row) => row.cumulative);
    const balanceWeights = points.map((point, at) => (weight[point].actual as number) - eaten[at] / density);
    const fittedLine = candidate === null ? null : forecast(index, balanceWeights, xs);

    rows.push({
      windowStart: calendar[from], windowDays, completeDays, recentCompleteDays, weightDays, weightSpan, coverage,
      meanIntake, meanIntakeLow, meanIntakeHigh, inferenceAllowance,
      slope: fittedSlope, slopeError: fittedError, uncertainty, candidate, candidateLow, candidateHigh, maxGap, refresh, gate,
      lastAccepted, accepted, acceptedLow, acceptedHigh, state,
      displayed: shown ? accepted : null,
      displayedLow: shown ? Math.max(0, (acceptedLow as number) - widening) : null,
      displayedHigh: shown ? (acceptedHigh as number) + widening : null,
      alpha, recentWeightDays, lastReadingSensitivity,
      timingIntake, timingIntakeLow: timing((row) => row.cumulativeLow), timingIntakeHigh: timing((row) => row.cumulativeHigh),
      fittedEndWeight: fittedLine === null ? null : fittedLine + own / density,
      timingCandidate: timingIntake === null || fittedSlope === null ? null : timingIntake - density * fittedSlope
    });
  }
  return rows;
}

/** The candidate of a sensitivity window that ends on `stop` and reaches back `length` days, or null when a gate fails. */
function sensitivityFit(rows: readonly ModelDay[], stop: string | null, length: number, gates: { complete: number; weights: number; span: number }, settings: Settings): number | null {
  if (stop === null) return null;
  const end = rows.findIndex((row) => row.day === stop);
  if (end < 0) return null;
  const earliest = addDays(stop, -(length - 1));
  const first = rows.findIndex((row, index) => index <= end && row.day >= earliest && row.weight.actual !== null);
  if (first < 0) return null;
  const window = rows.slice(first, end + 1);
  const points = window.map((row, offset) => ({ row, x: first + offset })).filter(({ row }) => row.weight.actual !== null);
  const intake = window.map((row) => row.intake.modeled);
  const observed = window.filter((row) => row.intake.eligible).length;
  const gaps = points.slice(1).map(({ row }) => row.weight.gap ?? 0);
  if (gaps.length === 0) return null;
  const days = end - first + 1;
  const xs = points.map(({ x }) => x);
  const passes = observed >= gates.complete && observed / days >= settings.minCoverage && intake.every((value) => value !== null)
    && points.length >= gates.weights && xs[xs.length - 1] - xs[0] >= gates.span && xs[xs.length - 1] === end && Math.max(...gaps) <= settings.maxWeightGap;
  const fitted = slope(points.map(({ row }) => row.weight.actual as number), xs);
  return passes && fitted !== null ? (mean(intake as number[]) as number) - settings.energyDensity * fitted : null;
}

function summarize(rows: readonly ModelDay[], checkIns: readonly CheckIn[], settings: Settings, at: { reviewDate: string; closedThrough: string; start: string | null }): ModelSummary {
  const { reviewDate, closedThrough, start } = at;
  const index = start !== null && closedThrough >= start ? rows.findIndex((row) => row.day === closedThrough) : -1;
  const modelIndex = index >= 0 ? index : null;
  const row = modelIndex === null ? null : rows[modelIndex];
  const engine = row?.engine ?? null;
  const state: EngineState = engine?.state ?? "Building";
  const shown = state === "Updating" || state === "Holding";
  const lastAccepted = engine?.lastAccepted ?? null;
  const acceptedRow = lastAccepted === null ? null : rows.find((one) => one.day === lastAccepted) ?? null;

  const tdeeMid = shown ? engine?.displayed ?? null : null;
  const acceptedCandidate = acceptedRow?.engine.candidate ?? null;
  const fit14 = sensitivityFit(rows, lastAccepted, 14, { complete: 11, weights: 7, span: 10 }, settings);
  const fit28 = sensitivityFit(rows, lastAccepted, 28, { complete: settings.minCompleteDays, weights: settings.minWeightDays, span: settings.minWeightSpan }, settings);
  const deviation = tdeeMid === null ? null
    : Math.max(Math.abs((acceptedCandidate ?? 0) - tdeeMid), fit14 === null ? 0 : Math.abs(fit14 - tdeeMid), fit28 === null ? 0 : Math.abs(fit28 - tdeeMid));
  let tdeeLow: number | null = null;
  let tdeeHigh: number | null = null;
  if (shown && engine) {
    const plausible = state === "Holding" && engine.candidate !== null && engine.candidate >= settings.expenditureMin && engine.candidate <= settings.expenditureMax;
    const pendingLow = plausible ? engine.candidateLow : engine.displayedLow;
    const pendingHigh = plausible ? engine.candidateHigh : engine.displayedHigh;
    tdeeLow = Math.max(0, Math.min(engine.displayedLow as number, (tdeeMid as number) - (deviation ?? 0), pendingLow ?? Number.POSITIVE_INFINITY));
    tdeeHigh = Math.max(engine.displayedHigh as number, (tdeeMid as number) + (deviation ?? 0), pendingHigh ?? Number.NEGATIVE_INFINITY);
  }

  const closed = (from: string | null) => rows.filter((one) => from !== null && one.day >= from && one.day <= closedThrough);
  const recent = closed(addDays(closedThrough, -6)).filter((one) => one.intake.eligible);
  const recentCompleteDays = engine?.recentCompleteDays ?? 0;
  const recentMean = (pick: (one: IntakeDay) => number | null) => (recentCompleteDays === 0 ? null : mean(recent.map((one) => pick(one.intake) as number)));
  const recentIntakeLow = recentMean((one) => one.kcalLow);
  const recentIntake = recentMean((one) => one.kcal);
  const recentIntakeHigh = recentMean((one) => one.kcalHigh);
  const balanceLow = state === "Updating" && recentCompleteDays >= settings.reviewMinCompleteDays && recentIntakeLow !== null && tdeeHigh !== null ? recentIntakeLow - tdeeHigh : null;
  const balanceMid = balanceLow === null ? null : (recentIntake as number) - (tdeeMid as number);
  const balanceHigh = balanceLow === null ? null : (recentIntakeHigh as number) - (tdeeLow as number);
  const targetBalanceLow = state === "Updating" && tdeeHigh !== null ? settings.calorieTarget - tdeeHigh : null;

  const weighed = rows.filter((one) => one.weight.actual !== null);
  const latest = weighed[weighed.length - 1] ?? null;
  const latestWeighIn = latest?.day ?? null;
  const reviewRow = rows.find((one) => one.day === reviewDate);
  const trend = latestWeighIn !== null && daysBetween(latestWeighIn, reviewDate) <= settings.freshDays ? reviewRow?.weight.trend ?? null : null;

  const windowStart = engine?.windowStart ?? null;
  const inWindow = closed(windowStart);
  const completeDays = engine?.completeDays ?? 0;
  const estimatedGapDays = windowStart === null ? 0 : inWindow.filter((one) => one.intake.modeledBasis === "Estimated gap day").length;
  const automaticCompleteDays = windowStart === null ? 0 : inWindow.filter((one) => one.intake.eligible && one.intake.basis.toLowerCase().startsWith("automatic")).length;
  const windowComplete = inWindow.filter((one) => one.intake.eligible);
  const interpretation = tdeeMid === null ? state
    : (deviation as number) > Math.max(300, 0.1 * tdeeMid) ? "Window-sensitive"
    : start !== null && daysBetween(start, closedThrough) + 1 < 28 ? "Limited history"
    : "Consistent windows";

  return {
    state, tdeeLow, tdeeMid, tdeeHigh, balanceLow, balanceMid, balanceHigh,
    weeklyChangeLow: balanceLow === null ? null : (balanceLow * 7) / settings.energyDensity,
    weeklyChangeHigh: balanceHigh === null ? null : (balanceHigh * 7) / settings.energyDensity,
    lastAccepted, closedThrough, latestWeighIn, latestWeight: latest?.weight.actual ?? null, trend,
    startWeight: weighed[0]?.weight.actual ?? null,
    windowStart, windowDays: engine?.windowDays ?? 0, completeDays, weightDays: engine?.weightDays ?? 0, weightSpan: engine?.weightSpan ?? 0,
    coverage: engine?.coverage ?? 0, recentCompleteDays, gate: engine?.gate ?? "No closed-day history",
    acceptedAge: lastAccepted === null ? null : daysBetween(lastAccepted, closedThrough),
    legacyCompletions: windowStart === null ? 0 : checkIns.filter((one) => one.day >= windowStart && one.day <= closedThrough && one.reported === "Complete" && one.basis === LEGACY_BASIS).length,
    start, version: MODEL_VERSION, targetBalanceLow, targetBalanceHigh: targetBalanceLow === null ? null : settings.calorieTarget - (tdeeLow as number),
    recentIntakeLow, recentIntake, recentIntakeHigh, reviewDate, modelIndex,
    acceptedCandidate, fit14, fit28, deviation, warningThreshold: tdeeMid === null ? null : Math.max(300, 0.1 * tdeeMid), interpretation,
    weightAge: latestWeighIn === null ? null : daysBetween(latestWeighIn, reviewDate),
    acceptedWindowStart: acceptedRow?.engine.windowStart ?? null,
    acceptedWindowDays: acceptedRow ? daysBetween(acceptedRow.engine.windowStart, acceptedRow.day) + 1 : null,
    completeDaysAvailable: rows.filter((one) => one.intake.eligible).length,
    weighInDaysAvailable: rows.filter((one) => one.day <= closedThrough && one.weight.actual !== null).length,
    estimatedGapDays, unresolvedDays: windowStart === null ? 0 : (engine?.windowDays ?? 0) - completeDays - estimatedGapDays,
    automaticCompleteDays, recordedCompleteDays: completeDays - automaticCompleteDays,
    meanModeledIntake: engine?.meanIntake ?? null,
    completeLogMean: completeDays === 0 ? null : mean(windowComplete.map((one) => one.intake.kcal as number)),
    recentWeightDays: engine?.recentWeightDays ?? 0,
    candidate: engine?.candidate ?? null, timingCandidate: engine?.timingCandidate ?? null, lastReadingSensitivity: engine?.lastReadingSensitivity ?? null,
    notes: {
      intake: `Minimum ${settings.minCompleteDays} days and ${Math.round(settings.minCoverage * 100)}% coverage. A rough but complete day can qualify; a partial day cannot.`,
      weights: `Minimum ${settings.minWeightDays} actual daily means. Synthetic/interpolated values never increase this count.`,
      span: `Minimum ${settings.minWeightSpan} elapsed days; internal gaps may not exceed ${settings.maxWeightGap} days.`
    }
  };
}
