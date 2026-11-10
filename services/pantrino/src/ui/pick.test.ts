import { UNSORTED_SECTION } from "@tools-platform/service/kitchen-contract";
import { describe, expect, it } from "vitest";
import { pickSections } from "./pick";

const items = [
  { id: "1", label: "Rice", group: "Grains" },
  { id: "2", label: "Beans", group: "Proteins" },
  { id: "3", label: "Barley", group: "Grains" },
  { id: "4", label: "Salt", group: UNSORTED_SECTION },
];

describe("pick sections", () => {
  it("lists every item under its group in the kitchen's order, by name inside a group", () => {
    expect(pickSections(items, ["Proteins", "Grains"], "").map(([group, rows]) => [group, rows.map((row) => row.label)]))
      .toEqual([["Proteins", ["Beans"]], ["Grains", ["Barley", "Rice"]], [UNSORTED_SECTION, ["Salt"]]]);
  });

  it("keeps only items whose name holds the typed text, and drops empty groups", () => {
    expect(pickSections(items, ["Proteins", "Grains"], " BA ").map(([group, rows]) => [group, rows.map((row) => row.id)])).toEqual([["Grains", ["3"]]]);
    expect(pickSections(items, [], "zzz")).toEqual([]);
  });
});
