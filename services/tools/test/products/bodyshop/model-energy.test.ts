import { describe, expect, it } from "vitest";
import { activityView, energyView, stepEnergy } from "../../../products/bodyshop/model/energy.js";
import { runModel } from "../../../products/bodyshop/model/engine.js";
import { checkIn, completeDays, dailyWeights, on, settings } from "./model-fixtures.js";

const days = completeDays(30);
const model = runModel({ days, weights: dailyWeights(30), checkIns: [], settings, asOf: on(29) });
const profile = { heightCm: 180, strideRatio: 0.4, walkingCost: 0.5, age: 40, sex: "Male" as const };

describe("maintenance decision", () => {
  it("rounds the working maintenance and keeps the calorie target", () => {
    const view = energyView(model, settings);
    expect(view).toMatchObject({
      maintenance: "~3,000 kcal/day",
      target: "2,500 kcal/day",
      recentIntake: "3,000 kcal/day",
      weightTrend: "0.00 kg/week",
      stressRange: "Stress range: 2,550 - 3,450 kcal/day | subjective, not a confidence interval",
      decision: "KEEP 2,500 kcal target. No automatic target change is made. Review sustained weight change, logging coverage, activity and recovery together.",
      slopes: "Weight slopes: 21 days 0.00 kg/week; 14 days 0.00 kg/week. This is trend evidence, not a fat-loss measurement.",
      fit28Label: "Up to 28 days (28 available)",
      inferredDays: []
    });
    expect(view.accepted.intake).toBeCloseTo(3000, 6);
    expect(view.modelAllowance).toBeCloseTo(150, 6);
  });

  it("asks for more evidence before there is an estimate", () => {
    const building = runModel({ days: completeDays(5), weights: dailyWeights(5), checkIns: [], settings, asOf: on(5) });
    expect(energyView(building, settings)).toMatchObject({
      maintenance: "Not ready",
      decision: "Keep the existing calorie target. Model status: Building. More complete intake and actual weigh-ins are needed.",
      stressRange: "Stress range unavailable until the model has sufficient evidence",
      accepted: { intake: null, weeklySlope: null, expenditure: null }
    });
  });
});

describe("step energy", () => {
  const reports = Array.from({ length: 29 }, (_, offset) => checkIn(on(offset), { steps: offset === 28 ? 20000 : 10000, reported: offset === 10 ? null : "Complete" }));

  it("splits maintenance into a non-walking base and each day's walking estimate", () => {
    const steps = stepEnergy(model, days, reports, settings, profile, 28);
    const meanWalking = (20 * 360 + 720) / 21;
    expect(steps.days).toHaveLength(90);
    expect(steps).toMatchObject({ stepDays: 21, status: "Scenario only", calibrationText: "21 / 21 usable calibration days", restingText: "1,930 kcal | equation only" });
    expect(steps.meanWalking).toBeCloseTo(meanWalking, 9);
    expect(steps.base).toBeCloseTo(3000 - meanWalking, 9);
    expect(steps.resting).toBeCloseTo(1930, 9);
    const last = steps.latest;
    expect(last?.day).toBe(on(28));
    expect(last?.distanceKm).toBeCloseTo(14.4, 9);
    expect(last?.walkingKcal).toBeCloseTo(720, 9);
    expect(last?.totalKcal).toBeCloseTo(3000 - meanWalking + 720, 9);
    expect(last?.balance).toBeCloseTo(meanWalking - 720, 9);
    expect(last?.remainingKcal).toBeCloseTo(3000 - meanWalking - 1930, 9);
  });

  it("uses the Check-ins reported status, so a day without a report has no balance", () => {
    const day = stepEnergy(model, days, reports, settings, profile, 28).days.find((one) => one.day === on(10));
    expect(day).toMatchObject({ status: "Unknown", balance: null, loggedKcal: 3000 });
  });

  it("withholds conflicting step counts and reports a sparse history", () => {
    const conflicting = [checkIn(on(20), { steps: 10000 }), checkIn(on(20), { steps: 12000 })];
    const steps = stepEnergy(model, days, conflicting, settings, { ...profile, age: null }, 28);
    expect(steps.days.find((one) => one.day === on(20))).toMatchObject({ steps: null, status: "Conflicting step reports" });
    expect(steps).toMatchObject({ base: null, status: "Usable step history sparse", resting: null, restingText: "Not estimated" });
  });
});

describe("activity", () => {
  const reports = [
    checkIn(on(0), { steps: 8000, sleep: 7, hunger: 3, training: "Gym" }),
    checkIn(on(1), { steps: 6000, hunger: 9, training: "None" }),
    checkIn(on(2), { training: "Gym" }),
    checkIn(on(2), { training: "Other" })
  ];

  it("averages reported days only and treats missing reports as unknown", () => {
    const view = activityView(days, reports, on(6), 7);
    expect(view.days[0]).toMatchObject({ steps: 8000, sleep: 7, hunger: 3, training: 1, trainingStatus: "Training reported" });
    expect(view.days[1]).toMatchObject({ hunger: null, training: 0, trainingStatus: "No training reported" });
    expect(view.days[3]).toMatchObject({ steps: null, training: null, trainingStatus: "Not logged" });
    expect(view).toMatchObject({ trainingDays: "2", averageSteps: "7,000", averageSleep: "7.0 h", trainingCoverage: "3 / 7 days", stepReports: "2 day(s) with step reports" });
  });

  it("counts training reports per Monday-to-Sunday week", () => {
    const weeks = activityView(days, reports, on(6), 7).weeks;
    expect(weeks).toHaveLength(12);
    expect(weeks[11]).toMatchObject({ start: "2026-01-05", trainingDays: null, trainingStatusDays: 0, complete: 3, noLog: 0 });
    expect(weeks[10]).toMatchObject({ start: "2025-12-29", trainingDays: 3, trainingStatusDays: 4, complete: 4, noLog: 3 });
  });
});
