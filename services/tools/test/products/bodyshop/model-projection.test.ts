import { describe, expect, it } from "vitest";
import type { WeightReading } from "../../../products/bodyshop/domain.js";
import { runModel } from "../../../products/bodyshop/model/engine.js";
import { projectWeight } from "../../../products/bodyshop/model/projection.js";
import { completeDays, dailyWeights, on, settings } from "./model-fixtures.js";

const project = (weights: WeightReading[], review = 27) => {
  const model = runModel({ days: completeDays(review + 1), weights, checkIns: [], settings, asOf: on(review) });
  return { projection: projectWeight(model.rows, model.summary, settings), trend: model.summary.trend as number };
};

describe("weight projection", () => {
  it("projects the observed 21-day rate over the horizon with the uncertainty floor", () => {
    const { projection, trend } = project(dailyWeights(28, 100, -0.05));
    const halfWidth = trend * 0.0025;
    expect(projection).toMatchObject({ status: "Ready", trendStatus: "Conditional projection", weighInDays: 21, span: 20, maxGap: 1 });
    expect(projection.weeklyRate).toBeCloseTo(-0.35, 9);
    expect(projection.rate14).toBeCloseTo(-0.35, 9);
    expect(projection.windowSensitivity).toBeCloseTo(0, 9);
    expect(projection.weeklyHalfWidth).toBeCloseTo(halfWidth, 9);
    expect(projection.mid).toBeCloseTo(trend - 1.4, 9);
    expect(projection.low).toBeCloseTo(trend + (-0.35 - halfWidth) * 4, 9);
    expect(projection.high).toBeCloseTo(trend + (-0.35 + halfWidth) * 4, 9);
    expect(projection.targetShort).toBeCloseTo(trend * 0.995 ** 4, 9);
    expect(projection.targetLong).toBeCloseTo(trend * 0.995 ** 8, 9);
    expect(projection.path).toHaveLength(29);
    expect(projection.path[0]).toMatchObject({ day: on(27), kg: trend });
    expect(projection.path[28].kg).toBeCloseTo(trend - 1.4, 9);
    expect(projection.summary).toMatch(/^Goal distance: \d+\.\d kg to 90 kg\. 4-week conditional trend: .* kg scenario\)\. Conditional projection; not a fat-mass forecast\.$/);
  });

  it("asks for review when the rate passes the loss guardrail", () => {
    const { projection } = project(dailyWeights(28, 100, -0.2));
    expect(projection).toMatchObject({ status: "Review: rapid trend", mid: null, weeklyRate: null, path: [] });
    expect(projection.summary).toMatch(/Projection unavailable: Review: rapid trend\.$/);
  });

  it("stops after three days without a measured weight", () => {
    expect(project(dailyWeights(24, 100, -0.05)).projection.status).toBe("Stale weight");
  });

  it("builds until there are enough weigh-ins over enough days", () => {
    expect(project(dailyWeights(28, 100, -0.05).filter((_, index) => index % 4 === 3)).projection.status).toBe("Building");
  });

  it("has no trend when the latest measured weight is older than the fresh-data age limit", () => {
    const { projection } = project(dailyWeights(19, 100, -0.05));
    expect(projection).toMatchObject({ status: "No fresh trend", trend: null, targetShort: null });
    expect(projection.summary).toBe("Waiting for fresh weight data. Projection unavailable: No fresh trend.");
  });
});
