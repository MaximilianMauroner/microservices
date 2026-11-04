import type { Setting } from "./domain.js";

/**
 * The typed values that the calculations read from the settings rows. Rows are matched by label, so a
 * reordered settings list still reads the same values. A missing or empty row keeps the default.
 * The defaults are the values of model version BS-1.3.0.
 */
export const SETTING_DEFAULTS = {
  calorieTarget: 2500,
  proteinTarget: 150,
  carbTarget: 300,
  fatTarget: 75,
  fiberTarget: 30,
  goalLow: 85,
  goalHigh: 90,
  rateTargetPercent: 0.5,
  rateReferenceWeight: 105.4,
  energyDensity: 7700,
  weightMeanMinDays: 3,
  reviewMinCompleteDays: 5,
  trendAlpha: 0.2,
  projectionMinWeighDays: 8,
  projectionMinSpan: 14,
  projectionMaxLossPercent: 1,
  projectionMaxGainPercent: 0.5,
  projectionFloorPercent: 0.25,
  projectionHorizonWeeks: 4,
  modelWindow: 21,
  minCompleteDays: 14,
  minCoverage: 0.8,
  minRecentComplete: 4,
  minWeightDays: 6,
  minWeightSpan: 14,
  maxWeightGap: 7,
  expenditureAlpha: 0.2,
  errorFloor: 150,
  slopeMultiplier: 2,
  missingAllowance: 0.5,
  energyUncertainty: 0.2,
  freshDays: 7,
  staleDays: 14,
  holdingGrowth: 25,
  expenditureMin: 1000,
  expenditureMax: 8000,
  rapidTrendReview: 0.02,
  dayStartHour: 4,
  inferenceWindow: 28,
  inferenceMinDays: 7,
  inferenceMaxConsecutive: 2,
  inferenceFloor: 0.5,
  minRecentWeights: 3,
  recentWeightWindow: 7,
  predictionHorizon: 7,
  heightCm: 187,
  strideRatio: 0.414,
  walkingCost: 0.5
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = { readonly [Key in SettingKey]: number };

/** The settings label that holds each value, as in the Settings sheet. */
export const SETTING_LABELS: Readonly<Record<SettingKey, string>> = {
  calorieTarget: "Daily calorie target",
  proteinTarget: "Protein target",
  carbTarget: "Carb target",
  fatTarget: "Fat target",
  fiberTarget: "Fiber target",
  goalLow: "Goal range lower end",
  goalHigh: "Goal range entry point",
  rateTargetPercent: "Weight-loss rate target",
  rateReferenceWeight: "Reference weight for rate target",
  energyDensity: "Energy equivalent used",
  weightMeanMinDays: "Weight mean card: minimum recorded days",
  reviewMinCompleteDays: "Weekly review: minimum complete food days",
  trendAlpha: "Trend weight smoothing factor",
  projectionMinWeighDays: "Observed projection: minimum weigh-in days",
  projectionMinSpan: "Observed projection: minimum date span",
  projectionMaxLossPercent: "Observed projection: max loss rate",
  projectionMaxGainPercent: "Observed projection: max gain rate",
  projectionFloorPercent: "Projection uncertainty floor",
  projectionHorizonWeeks: "Projection horizon",
  modelWindow: "Model window",
  minCompleteDays: "Minimum complete intake days",
  minCoverage: "Minimum intake coverage",
  minRecentComplete: "Minimum recent complete days",
  minWeightDays: "Minimum actual weight days",
  minWeightSpan: "Minimum weight date span",
  maxWeightGap: "Maximum internal weight gap",
  expenditureAlpha: "Expenditure smoothing factor",
  errorFloor: "Minimum model uncertainty",
  slopeMultiplier: "Slope uncertainty multiplier",
  missingAllowance: "Legacy missing-day allowance",
  energyUncertainty: "Energy-equivalent uncertainty",
  freshDays: "Fresh-data age limit",
  staleDays: "Stale-data age limit",
  holdingGrowth: "Holding uncertainty growth",
  expenditureMin: "Expenditure review lower bound",
  expenditureMax: "Expenditure review upper bound",
  rapidTrendReview: "Rapid scale-trend review threshold",
  dayStartHour: "Logging-day boundary",
  inferenceWindow: "Inference reference window",
  inferenceMinDays: "Minimum inference reference days",
  inferenceMaxConsecutive: "Maximum consecutive inferred days",
  inferenceFloor: "Inference uncertainty floor",
  minRecentWeights: "Minimum recent actual weight days",
  recentWeightWindow: "Recent actual-weight window",
  predictionHorizon: "Conditional prediction test horizon",
  heightCm: "Height for step distance",
  strideRatio: "Stride length as share of height",
  walkingCost: "Walking cost per kg and km"
};

export function readSettings(rows: readonly Pick<Setting, "label" | "value">[]): Settings {
  const byLabel = new Map(rows.map((row) => [row.label.trim().toLowerCase(), row.value]));
  const settings = { ...SETTING_DEFAULTS } as Record<SettingKey, number>;
  for (const key of Object.keys(SETTING_LABELS) as SettingKey[]) {
    const value = byLabel.get(SETTING_LABELS[key].toLowerCase());
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
    if (Number.isFinite(number)) settings[key] = number;
  }
  return settings;
}

/**
 * Birthday and sex for the resting energy equation. They are setting rows too, so they stay sealed with the
 * other settings, but their values are text, so `readSettings` does not read them.
 */
export const PROFILE_LABELS = { birthday: "Birthday", sex: "Sex" } as const;
export const SEXES = ["Male", "Female"] as const;
export type Profile = Readonly<{ birthday: string | null; sex: (typeof SEXES)[number] | null }>;

export function readProfile(rows: readonly Pick<Setting, "label" | "value">[]): Profile {
  const value = (label: string) => rows.find((row) => row.label.trim().toLowerCase() === label.toLowerCase())?.value;
  const birthday = value(PROFILE_LABELS.birthday);
  const sex = value(PROFILE_LABELS.sex);
  return {
    birthday: typeof birthday === "string" && /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday : null,
    sex: SEXES.find((one) => one === sex) ?? null
  };
}

/** Full years from a birthday to a day, both as YYYY-MM-DD. */
export function ageOn(birthday: string, day: string): number {
  const years = Number(day.slice(0, 4)) - Number(birthday.slice(0, 4));
  return day.slice(5) < birthday.slice(5) ? years - 1 : years;
}
