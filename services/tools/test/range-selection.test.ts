import { describe, expect, it } from "vitest";
import { toggleVisibleAll, toggleVisibleRange } from "../src/lib/range-selection.js";

const visible = ["a", "b", "c", "d"];

describe("inventory range selection", () => {
  it("adds an inclusive Shift range while preserving earlier selections", () => {
    expect([...toggleVisibleRange(new Set(["a"]), visible, "b", "d", true)]).toEqual(["a", "b", "c", "d"]);
  });

  it("toggles an individual row and selects only visible results", () => {
    expect([...toggleVisibleRange(new Set(["a", "b"]), visible, "a", "a", false)]).toEqual(["b"]);
    expect([...toggleVisibleAll(new Set(["hidden", "a"]), visible)]).toEqual(["hidden", "a", "b", "c", "d"]);
    expect([...toggleVisibleAll(new Set(["hidden", ...visible]), visible)]).toEqual(["hidden"]);
  });
});
