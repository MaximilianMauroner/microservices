import { describe, expect, it } from "vitest";
import { moneyCategorySearchValue } from "../money/money-category-picker.js";
import { MONEY_CATEGORIES } from "../money/money-enums.js";

describe("money category picker search", () => {
  it("includes every category in the searchable catalog", () => {
    for (const category of MONEY_CATEGORIES) {
      expect(moneyCategorySearchValue(category)).toContain(category);
    }
  });

  it.each([
    ["transport", "train"],
    ["transport", "metro"],
    ["travel", "flight"],
    ["travel", "hotel"],
    ["dining", "coffee"],
    ["housing", "rent"],
    ["personal_care", "barber"],
    ["personal_care", "hairdresser"],
    ["investments", "etf"],
    ["income", "salary"],
    ["education", "daycare"],
    ["health", "veterinary"],
    ["subscriptions", "internet"],
    ["fees", "accountant"],
    ["housing", "maintenance"],
  ] as const)("matches %s from the term %s", (category, term) => {
    expect(moneyCategorySearchValue(category)).toContain(term);
  });
});
