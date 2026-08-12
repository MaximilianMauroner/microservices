import { describe, expect, it } from "vitest";
import { projectMoneyTrajectory } from "../money/money-tracker-page.js";

describe("Money trajectory predictions", () => {
  it("continues a monthly linear trajectory across the selected horizon", () => {
    const prediction = projectMoneyTrajectory(
      Array.from({ length: 12 }, (_, index) => ({
        date: `2025-${String(index + 1).padStart(2, "0")}`,
        total: 10_000 + index * 500,
      })),
      12,
    );

    expect(prediction).toBeDefined();
    expect(prediction?.historyMonths).toBe(12);
    expect(prediction?.monthlySlope).toBeCloseTo(500);
    expect(prediction?.forecast).toHaveLength(12);
    expect(prediction?.forecast.at(-1)).toEqual(
      expect.objectContaining({ date: "2026-12", estimate: 21_500 }),
    );
    expect(prediction?.fit).toBeCloseTo(1);
  });

  it("widens the range with distance and limits the model to recent history", () => {
    const prediction = projectMoneyTrajectory(
      Array.from({ length: 48 }, (_, index) => ({
        date: `${2022 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`,
        total: 10_000 + index * 250 + (index % 2 ? 400 : -400),
      })),
      24,
    );

    const first = prediction?.forecast[0];
    const last = prediction?.forecast.at(-1);
    expect(prediction?.historyMonths).toBe(36);
    expect((last?.range[1] ?? 0) - (last?.range[0] ?? 0)).toBeGreaterThan(
      (first?.range[1] ?? 0) - (first?.range[0] ?? 0),
    );
  });

  it("requires six monthly snapshots", () => {
    expect(
      projectMoneyTrajectory(
        Array.from({ length: 5 }, (_, index) => ({
          date: `2026-0${index + 1}`,
          total: index * 100,
        })),
        6,
      ),
    ).toBeUndefined();
  });
});
