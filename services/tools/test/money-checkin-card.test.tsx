import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoneyCheckInCard } from "../money/money-checkin-card.js";
import type { MoneyCheckIn, MoneyCheckInPositionMove } from "../money/money-checkin-domain.js";

describe("money check-in card", () => {
  it("shows the four largest losses and gains and summarizes the rest", () => {
    const moves = [785, 520, 360, 140, 120, 65, -18, -55, -132, -279, -414].map((euros, index) => move(`Position ${index}`, euros * 100));
    const html = renderToStaticMarkup(<MoneyCheckInCard checkIn={checkIn(moves)} accountLabels={{}} />);

    expect(html).toContain("What changed since check-in");
    expect(html).toContain("24 Aug 2026");
    expect(html).toMatch(/Losses.*-898/);
    expect(html).toMatch(/Gains.*\+1\.990/);
    expect(html).toContain("Position 0");
    expect(html).toContain("Position 3");
    expect(html).not.toContain("Position 4<");
    expect(html).toContain("2 more · +185");
    expect(html).toContain("1 more · -18");
    expect(html).toContain("Show all 11");
    expect(html).not.toContain(">Other<");
  });

  it("shows an unexplained remainder instead of hiding it", () => {
    const html = renderToStaticMarkup(<MoneyCheckInCard checkIn={{ ...checkIn([]), bridge: { ...checkIn([]).bridge, otherMinor: -12_300 } }} accountLabels={{}} />);

    expect(html).toContain(">Other<");
    expect(html).toContain("-123");
    expect(html).toContain("No positions changed value since this check-in.");
  });
});

function move(name: string, moveMinor: number): MoneyCheckInPositionMove {
  return { canonicalKey: name, name, assetClass: "equity", baselineValueMinor: 100_000, currentValueMinor: 100_000 + moveMinor, boughtMinor: 0, soldMinor: 0, moveMinor, returnPercent: moveMinor / 1_000, closed: false };
}

function checkIn(positions: readonly MoneyCheckInPositionMove[]): MoneyCheckIn {
  return {
    days: ["2026-07-27", "2026-08-24", "2026-09-26"],
    baseline: "2026-08-24",
    positions,
    unpricedNames: [],
    cash: [],
    bridge: { baselineNetWorthMinor: 7_133_000, marketMinor: 109_200, incomeMinor: 428_000, spendingMinor: -311_800, otherMinor: 0, currentNetWorthMinor: 7_358_400 }
  };
}
