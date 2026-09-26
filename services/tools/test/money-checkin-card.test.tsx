import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoneyCheckInCard } from "../money/money-checkin-card.js";
import type { MoneyCheckIn, MoneyCheckInOverview, MoneyCheckInPositionMove } from "../money/money-checkin-domain.js";

describe("money check-in card", () => {
  it("shows gains and losses head to head, largest first, six per column", () => {
    const moves = [785, 520, 360, 140, 120, 65, 30, 12, -18, -55, -132, -279, -414].map((euros, index) => move(`Position ${index}`, euros * 100));
    const html = renderToStaticMarkup(<MoneyCheckInCard checkIn={checkIn(moves)} overview={overview()} accountLabels={{}} />);

    expect(html).toContain("What changed since check-in");
    expect(html).toMatch(/Gains.*\+2\.032.*· 8/);
    expect(html).toMatch(/Losses.*-898.*· 5/);
    expect(html.indexOf("Position 12")).toBeLessThan(html.indexOf("Position 8"));
    expect(html).toContain("Position 5");
    expect(html).not.toContain("Position 6<");
    expect(html).toContain("+2 more · +42");
    expect(html).toMatch(/Positions.*13.*Cash accounts.*0.*Spending.*0/);
  });

  it("shows an unexplained remainder as its own tile", () => {
    const html = renderToStaticMarkup(<MoneyCheckInCard checkIn={checkIn([])} overview={overview({ otherMinor: -12_300 })} accountLabels={{}} />);

    expect(html).toContain(">Other<");
    expect(html).toContain("-123");
    expect(html).toContain("None");
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
    bridge: { baselineNetWorthMinor: 7_133_000, marketMinor: 109_200, incomeMinor: 428_000, spendingMinor: -311_800, otherMinor: 0, currentNetWorthMinor: 7_358_400, ...bridge },
    spending: { previousBaseline: "2026-07-27", currentTotalMinor: 0, previousTotalMinor: 0, categories: [] }
  };
}
