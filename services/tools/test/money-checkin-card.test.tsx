import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoneyCheckInBridge } from "../money/money-checkin-card.js";
import type { MoneyCheckIn, MoneyCheckInOverview, MoneyCheckInPositionMove } from "../money/money-checkin-domain.js";

describe("money check-in bridge", () => {
  it("opens the market row with the largest position moves first, six at most", () => {
    const moves = [785, 520, 360, 140, 120, 65, 30, 12, -18, -55, -132, -279, -414].map((euros, index) => move(`Position ${index}`, euros * 100));
    const html = renderToStaticMarkup(<MoneyCheckInBridge checkIn={checkIn(moves)} overview={overview()} accountLabels={{}} />);

    expect(html).toContain("Since check-in");
    expect(html).toMatch(/Net worth 24 Aug.*71\.330/s);
    expect(html).toMatch(/aria-expanded="true".*Market.*\+1\.092/s);
    expect(html.indexOf("Position 1<")).toBeLessThan(html.indexOf("Position 12<"));
    expect(html.indexOf("Position 12<")).toBeLessThan(html.indexOf("Position 2<"));
    expect(html).toContain("Position 3");
    expect(html).not.toContain("Position 4<");
    expect(html).toMatch(/Net worth now.*\+2\.254.*73\.584/s);
  });

  it("shows an unexplained remainder as its own row", () => {
    const html = renderToStaticMarkup(<MoneyCheckInBridge checkIn={checkIn([])} overview={overview({ otherMinor: -12_300 })} accountLabels={{}} />);

    expect(html).toContain("Other");
    expect(html).toContain("-123");
    expect(html).toContain("Nothing recorded since the check-in.");
  });
});

function move(name: string, moveMinor: number): MoneyCheckInPositionMove {
  return { canonicalKey: name, name, assetClass: "equity", baselineValueMinor: 100_000, currentValueMinor: 100_000 + moveMinor, boughtMinor: 0, soldMinor: 0, moveMinor, returnPercent: moveMinor / 1_000, closed: false };
}

function checkIn(positions: readonly MoneyCheckInPositionMove[]): MoneyCheckIn {
  return { days: ["2026-07-27", "2026-08-24", "2026-09-26"], baseline: "2026-08-24", positions, unpricedNames: [] };
}

function overview(bridge: Partial<MoneyCheckInOverview["bridge"]> = {}): MoneyCheckInOverview {
  return {
    cash: [],
    bridge: { baselineNetWorthMinor: 7_133_000, marketMinor: 109_200, incomeMinor: 367_400, spendingMinor: -251_200, otherMinor: 0, currentNetWorthMinor: 7_358_400, ...bridge },
    spending: { previousBaseline: "2026-07-27", currentTotalMinor: 0, previousTotalMinor: 0, categories: [] }
  };
}
