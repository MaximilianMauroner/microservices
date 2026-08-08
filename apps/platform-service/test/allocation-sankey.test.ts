import { describe, expect, it } from "vitest";
import { buildAllocationSankeyData } from "../src/features/money/allocation-sankey.js";

describe("allocation Sankey data", () => {
  it("builds total to category to account flows", () => {
    expect(buildAllocationSankeyData([
      { name: "Checking", value: 1_200, category: "money" },
      { name: "Brokerage Stocks", value: 2_800, category: "stocks" }
    ])).toEqual({
      nodes: [
        { name: "account:Checking", label: "Checking", color: "#67e8f9", kind: "account", share: 30 },
        { name: "account:Brokerage Stocks", label: "Brokerage Stocks", color: "#c084fc", kind: "account", share: 70 },
        { name: "category:money", label: "Cash", color: "#67e8f9", kind: "category", share: 30 },
        { name: "category:stocks", label: "Stocks", color: "#c084fc", kind: "category", share: 70 }
      ],
      links: [
        { source: 0, target: 2, value: 1_200 },
        { source: 1, target: 3, value: 2_800 }
      ]
    });
  });

  it("omits balances that cannot be represented as Sankey widths", () => {
    expect(buildAllocationSankeyData([
      { name: "Checking", value: 500, category: "money" },
      { name: "Credit", value: -100, category: "money" },
      { name: "Empty", value: 0, category: "stocks" }
    ])).toMatchObject({
      nodes: [
        { name: "account:Checking" },
        { name: "category:money" }
      ],
      links: [
        { source: 0, target: 1, value: 500 }
      ]
    });
  });
});
