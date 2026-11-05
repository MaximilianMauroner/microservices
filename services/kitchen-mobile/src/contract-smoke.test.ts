import { expect, it } from "vitest";
import { kitchenAction, weekStart } from "@tools-platform/service/kitchen-contract";

it("loads the shared Kitchen contract", () => {
  expect(weekStart("2026-11-05")).toBe("2026-11-02");
  expect(kitchenAction.safeParse({ type: "stock.add", ingredientId: "a", amount: 1 }).success).toBe(true);
});
