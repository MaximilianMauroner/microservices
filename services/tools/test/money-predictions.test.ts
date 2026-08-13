import { describe, expect, it } from "vitest";
import { projectMoneyTrajectory } from "../money/money-tracker-page.js";

const months = Array.from({ length: 12 }, (_, index) => ({
  date: `2025-${String(index + 1).padStart(2, "0")}`,
  total: 20_000 + index * 500,
}));

function portfolio(growth = 0.01, contributionMinor = 50_000) {
  let costBasisMinor = 1_000_000;
  let knownMarketValueMinor = 1_000_000;
  let inflationBenchmarkMinor = 1_000_000;
  return Array.from({ length: 12 }, (_, index) => {
    if (index > 0) {
      costBasisMinor += contributionMinor;
      knownMarketValueMinor =
        knownMarketValueMinor * (1 + growth) + contributionMinor;
      inflationBenchmarkMinor =
        inflationBenchmarkMinor * 1.002 + contributionMinor;
    }
    return {
      date: `2025-${String(index + 1).padStart(2, "0")}-28`,
      costBasisMinor,
      knownMarketValueMinor,
      inflationBenchmarkMinor,
      complete: true,
    };
  });
}

describe("Money trajectory predictions", () => {
  it("adds recurring contributions after compounding portfolio growth", () => {
    const prediction = projectMoneyTrajectory(months, 12, portfolio());

    expect(prediction?.historyMonths).toBe(12);
    expect(prediction?.monthlyContribution).toBeCloseTo(500);
    expect(prediction?.annualGrowthRate).toBeCloseTo(1.01 ** 12 - 1);
    expect(prediction?.annualInflationRate).toBeCloseTo(1.002 ** 12 - 1);

    const currentPortfolio = portfolio().at(-1)!.knownMarketValueMinor / 100;
    let expectedPortfolio = currentPortfolio;
    for (let month = 0; month < 12; month += 1) {
      expectedPortfolio = expectedPortfolio * 1.01 + 500;
    }
    const currentCash = months.at(-1)!.total - currentPortfolio;
    expect(prediction?.forecast.at(-1)?.estimate).toBeCloseTo(
      currentCash + expectedPortfolio,
    );
  });

  it("anchors the cone at the current value and widens it by return uncertainty", () => {
    const variablePortfolio = portfolio().map((point, index, points) => {
      if (index === 0) return point;
      const previous = points[index - 1]!;
      const basisChange = point.costBasisMinor - previous.costBasisMinor;
      const growth = index % 2 ? 0.03 : -0.01;
      return {
        ...point,
        knownMarketValueMinor:
          previous.knownMarketValueMinor * (1 + growth) + basisChange,
      };
    });
    const prediction = projectMoneyTrajectory(months, 24, variablePortfolio);
    const anchor = prediction?.points[(prediction?.historyMonths ?? 0) - 1];
    const first = prediction?.forecast[0];
    const last = prediction?.forecast.at(-1);

    expect(anchor?.range).toEqual([anchor?.actual, anchor?.actual]);
    expect((last?.range[1] ?? 0) - (last?.range[0] ?? 0)).toBeGreaterThan(
      (first?.range[1] ?? 0) - (first?.range[0] ?? 0),
    );
  });

  it("does not count contributions as investment returns", () => {
    const prediction = projectMoneyTrajectory(months, 12, portfolio(0, 50_000));

    expect(prediction?.monthlyContribution).toBeCloseTo(500);
    expect(prediction?.annualGrowthRate).toBeCloseTo(0);
  });

  it("recalculates every path with a custom monthly contribution", () => {
    const historical = projectMoneyTrajectory(months, 12, portfolio());
    const customized = projectMoneyTrajectory(months, 12, portfolio(), 900);

    expect(customized?.monthlyContribution).toBe(900);
    expect(customized?.forecast.at(-1)?.estimate).toBeGreaterThan(
      historical?.forecast.at(-1)?.estimate ?? 0,
    );
    expect(customized?.forecast.at(-1)?.range[0]).toBeGreaterThan(
      historical?.forecast.at(-1)?.range[0] ?? 0,
    );
    expect(customized?.forecast.at(-1)?.inflation).toBeGreaterThan(
      historical?.forecast.at(-1)?.inflation ?? 0,
    );
  });

  it("uses the latest five years of returns", () => {
    const longMonths = Array.from({ length: 72 }, (_, index) => ({
      date: `${2020 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`,
      total: 20_000 + index * 500,
    }));
    let costBasisMinor = 1_000_000;
    let knownMarketValueMinor = 1_000_000;
    let inflationBenchmarkMinor = 1_000_000;
    const longPortfolio = longMonths.map((month, index) => {
      if (index > 0) {
        const growth = index < 12 ? 0.2 : 0.01;
        costBasisMinor += 50_000;
        knownMarketValueMinor = knownMarketValueMinor * (1 + growth) + 50_000;
        inflationBenchmarkMinor = inflationBenchmarkMinor * 1.002 + 50_000;
      }
      return {
        date: `${month.date}-28`,
        costBasisMinor,
        knownMarketValueMinor,
        inflationBenchmarkMinor,
        complete: true,
      };
    });

    const prediction = projectMoneyTrajectory(longMonths, 12, longPortfolio);

    expect(prediction?.historyMonths).toBe(60);
    expect(prediction?.annualGrowthRate).toBeCloseTo(1.01 ** 12 - 1);
  });

  it("requires six complete portfolio months", () => {
    expect(
      projectMoneyTrajectory(months, 6, portfolio().slice(0, 5)),
    ).toBeUndefined();
  });

  it("supports long-range planning checkpoints", () => {
    expect(projectMoneyTrajectory(months, 60, portfolio())?.forecast.at(-1)?.date).toBe(
      "2030-12",
    );
    expect(projectMoneyTrajectory(months, 120, portfolio())?.forecast.at(-1)?.date).toBe(
      "2035-12",
    );
  });
});
