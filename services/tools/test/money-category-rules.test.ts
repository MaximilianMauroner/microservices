import { describe, expect, it } from "vitest";
import { categoryRuleMatcher, normalizeCategoryRuleText, type MoneyCategoryRuleDefinition } from "../money/money-category-rules.js";

type Rule = MoneyCategoryRuleDefinition & { id: string };
const rule = (id: string, fields: Omit<Rule, "id">): Rule => ({ id, ...fields });
const card = { accountId: "cash", sourceType: "Card Payment" };

describe("category rules", () => {
  it("ignores case, accents, broken umlauts, and repeated spaces", () => {
    expect(normalizeCategoryRuleText("  Café   ZÜRICH ")).toBe("cafe zurich");
    expect(normalizeCategoryRuleText("MÃ¼nchner Markt")).toBe("munchner markt");
  });

  it("matches whole words, parts, prefixes, and complete descriptions", () => {
    const match = categoryRuleMatcher([
      rule("word", { matchField: "description", matchOperator: "word", matchValue: "bus", category: "transport" }),
      rule("contains", { matchField: "description", matchOperator: "contains", matchValue: "caf", category: "dining" }),
      rule("prefix", { matchField: "description", matchOperator: "starts_with", matchValue: "pp*", category: "other" }),
      rule("exact", { matchField: "description", matchOperator: "equals", matchValue: "apple", category: "shopping" }),
    ]);
    const id = (description: string) => match({ ...card, description })?.id;
    expect(id("Flix Bus 12")).toBe("word");
    expect(id("Business Lounge")).toBeUndefined();
    expect(id("Billardcafé")).toBe("contains");
    expect(id("PP*1234 Shop")).toBe("prefix");
    expect(id("Shop PP*1234")).toBeUndefined();
    expect(id("APPLE")).toBe("exact");
    expect(id("Apple Store")).toBeUndefined();
  });

  it("uses the first matching rule, including one that keeps rows uncategorized", () => {
    const match = categoryRuleMatcher([
      rule("pay", { matchField: "description", matchOperator: "contains", matchValue: "market pay", category: "uncategorized" }),
      rule("market", { matchField: "description", matchOperator: "word", matchValue: "market", category: "shopping" }),
    ]);
    expect(match({ ...card, description: "Market Pay 991" })?.category).toBe("uncategorized");
    expect(match({ ...card, description: "Corner Market" })?.category).toBe("shopping");
  });

  it("matches merchant codes and statement types, and respects the account scope", () => {
    const match = categoryRuleMatcher([
      rule("scoped", { accountId: "savings", matchField: "description", matchOperator: "word", matchValue: "shop", category: "gifts" }),
      rule("mcc", { matchField: "mcc", matchOperator: "equals", matchValue: "5411", category: "groceries" }),
      rule("atm", { matchField: "source_type", matchOperator: "equals", matchValue: "atm", category: "cash" }),
    ]);
    expect(match({ ...card, description: "Shop", mcc: "5411" })?.id).toBe("mcc");
    expect(match({ ...card, accountId: "savings", description: "Shop", mcc: "5411" })?.id).toBe("scoped");
    expect(match({ accountId: "cash", description: "Withdrawal", sourceType: "ATM" })?.id).toBe("atm");
    expect(match({ ...card, description: "Withdrawal", mcc: null })).toBeUndefined();
  });

  it("still matches rules stored as lowercase text before normalization", () => {
    const match = categoryRuleMatcher([rule("old", { matchField: "description", matchOperator: "equals", matchValue: "café  central", category: "dining" })]);
    expect(match({ ...card, description: "CAFE CENTRAL" })?.id).toBe("old");
  });
});
