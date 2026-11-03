import { describe, expect, it } from "vitest";
import { runModel } from "../../../products/bodyshop/model/engine.js";
import { checkIn, completeDays, dailyWeights, logged, on, settings } from "./model-fixtures.js";

const steady = { days: completeDays(30), weights: dailyWeights(30, 100, -0.1), checkIns: [], settings, asOf: on(29) };

describe("expenditure model", () => {
  it("accepts mean intake minus the weight slope times the energy equivalent once every gate passes", () => {
    const { rows, summary } = runModel(steady);
    expect(rows).toHaveLength(30);
    expect(rows[12].engine.gate).toBe("Building intake history");
    expect(rows[13].engine.gate).toBe("Building weight span");
    expect(rows[14].engine).toMatchObject({ gate: "Ready", state: "Updating", alpha: 1, windowDays: 15, weightSpan: 14 });
    expect(rows[14].engine.candidate).toBeCloseTo(3770, 6);
    expect(rows[14].engine.uncertainty).toBeCloseTo(304, 6);
    expect(rows[14].engine.candidateLow).toBeCloseTo(2700 + 770 - 304, 6);
    expect(rows[14].engine.candidateHigh).toBeCloseTo(3300 + 770 + 304, 6);
    expect(rows[15].engine.alpha).toBeCloseTo(0.2, 9);

    expect(summary).toMatchObject({ state: "Updating", closedThrough: on(28), reviewDate: on(29), lastAccepted: on(28), windowStart: on(8), windowDays: 21, interpretation: "Consistent windows" });
    expect(summary.tdeeMid).toBeCloseTo(3770, 6);
    expect(summary.tdeeLow).toBeCloseTo(3166, 6);
    expect(summary.tdeeHigh).toBeCloseTo(4374, 6);
    expect(summary.balanceLow).toBeCloseTo(2700 - 4374, 6);
    expect(summary.balanceMid).toBeCloseTo(-770, 6);
    expect(summary.balanceHigh).toBeCloseTo(3300 - 3166, 6);
    expect(summary.weeklyChangeLow).toBeCloseTo(((2700 - 4374) * 7) / 7700, 9);
    expect(summary.targetBalanceLow).toBeCloseTo(2500 - 4374, 6);
    expect(summary.fit14).toBeCloseTo(3770, 6);
    expect(summary.fit28).toBeCloseTo(3770, 6);
  });

  it("excludes the current logging day even when it is logged complete", () => {
    const { rows, summary } = runModel(steady);
    expect(rows[29].intake).toMatchObject({ eligible: false, modeled: null, modeledBasis: "Open logging day", cumulative: null });
    expect(rows[29].engine.state).toBe("Open day");
    expect(summary.modelIndex).toBe(28);
  });

  it("holds the accepted estimate without new weigh-ins and goes stale after the stale-data age limit", () => {
    const weights = dailyWeights(25, 100, -0.1);
    const holding = runModel({ ...steady, weights });
    expect(holding.summary).toMatchObject({ state: "Holding", lastAccepted: on(24), gate: "Waiting for weigh-in", acceptedAge: 4 });
    expect(holding.summary.tdeeMid).toBeCloseTo(3770, 6);
    expect(holding.summary.balanceLow).toBeNull();

    const later = runModel({ ...steady, days: completeDays(45), weights, asOf: on(44) });
    expect(later.summary.state).toBe("Stale");
    expect(later.summary.tdeeMid).toBeNull();
    expect(later.rows[24 + 7 + 3].engine.displayedLow).toBeCloseTo(3166 - 3 * 25, 6);
  });

  it("estimates up to two missing days from earlier complete days and leaves a third unresolved", () => {
    const days = completeDays(30).filter((_, index) => ![20, 25, 26, 27].includes(index));
    const { rows } = runModel({ ...steady, days });
    expect(rows[20].intake).toMatchObject({ status: "Missing", modeledBasis: "Estimated gap day", referenceDays: 20, modeled: 3000, inferenceHalfWidth: 1500, modeledLow: 1500, modeledHigh: 4500 });
    expect(rows[26].intake.modeledBasis).toBe("Estimated gap day");
    expect(rows[27].intake).toMatchObject({ modeledBasis: "Gap exceeds inference limit", modeled: null, nonCompleteRun: 3 });
    expect(rows[28].engine).toMatchObject({ meanIntake: null, gate: "Unresolved intake gap / data check", state: "Holding" });
  });

  it("estimates a partial day as at least the reference mean and keeps a complete day with a broken range for review", () => {
    const days = completeDays(30).map((day, index) => (index === 22 ? logged(day.day, 1200, { status: "Partial" }) : index === 23 ? logged(day.day, 3000, { range: null }) : day));
    const { rows } = runModel({ ...steady, days });
    expect(rows[22].intake).toMatchObject({ modeled: 3000, modeledLow: 1500, modeledHigh: 4500, modeledBasis: "Estimated gap day" });
    expect(rows[23].intake).toMatchObject({ eligible: false, modeled: null, modeledBasis: "Review calorie data" });
  });

  it("sends a candidate outside the review bounds to Review and hides the numbers", () => {
    const { summary } = runModel({ ...steady, days: completeDays(30, 9000) });
    expect(summary).toMatchObject({ state: "Review", gate: "Review: unusual expenditure", tdeeMid: null, tdeeLow: null });
  });

  it("counts legacy completions inside the window", () => {
    const checkIns = [checkIn(on(10), { reported: "Complete", basis: "Legacy auto-complete; not user-confirmed" }), checkIn(on(2), { reported: "Complete", basis: "Legacy auto-complete; not user-confirmed" })];
    expect(runModel({ ...steady, checkIns }).summary.legacyCompletions).toBe(1);
  });

  it("is Building with no records", () => {
    const { rows, summary } = runModel({ ...steady, days: [], weights: [] });
    expect(rows).toEqual([]);
    expect(summary).toMatchObject({ state: "Building", start: null, modelIndex: null, gate: "No closed-day history", tdeeMid: null });
  });
});
