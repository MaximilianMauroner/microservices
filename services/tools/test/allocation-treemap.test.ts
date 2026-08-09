import { describe, expect, it } from "vitest";
import { buildAllocationTreemap } from "../money/allocation-treemap.js";

describe("allocation treemap", () => {
  it("keeps positive accounts and assigns proportional shares", () => {
    const tiles = buildAllocationTreemap([
      { name: "Stocks", value: 75, category: "stocks" },
      { name: "Cash", value: 25, category: "money" },
      { name: "Debt", value: -10, category: "money" }
    ]);

    expect(tiles.map((tile) => tile.name)).toEqual(["Stocks", "Cash"]);
    expect(tiles.map((tile) => tile.share)).toEqual([75, 25]);
    expect(tiles.every((tile) => tile.width > 0 && tile.height > 0)).toBe(true);
  });

  it("returns no tiles without a positive balance", () => {
    expect(buildAllocationTreemap([{ name: "Empty", value: 0, category: "money" }])).toEqual([]);
  });

  it("keeps tiny positive balances visible and inside the map", () => {
    const tiles = buildAllocationTreemap([
      { name: "Main", value: 99_999, category: "stocks" },
      { name: "Tiny", value: 1, category: "money" }
    ]);

    expect(tiles).toHaveLength(2);
    expect(tiles.every((tile) => tile.width > 0 && tile.height > 0)).toBe(true);
    expect(tiles.every((tile) => tile.x >= 0 && tile.y >= 0 && tile.x + tile.width <= 100 && tile.y + tile.height <= 100)).toBe(true);
    expect(tiles.reduce((area, tile) => area + tile.width * tile.height, 0)).toBeCloseTo(10_000);
  });
});
