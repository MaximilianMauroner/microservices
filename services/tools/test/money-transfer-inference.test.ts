import { describe, expect, it } from "vitest";
import {
  inferTransferDisposition,
  isCardFundingDebit,
  isRuleTransferCandidate,
  matchCardFundingPairs,
  type CardFundingPairInput,
  type MoneyTransferPairRule,
  type MoneyTransferRule,
} from "../money/money-transfer-inference.js";

const rule = (priority: number, values: Partial<MoneyTransferRule> & Pick<MoneyTransferRule, "disposition">): MoneyTransferRule => ({
  id: `rule-${priority}-${values.matchValue ?? values.sourceType ?? "any"}`,
  priority,
  descriptionMatch: values.matchValue ? "equals" : "any",
  amountSign: "any",
  ...values,
});

// Neutral fixtures: real rules live in the database, not in code or tests.
const RULES: readonly MoneyTransferRule[] = [
  rule(900, { sourceType: "Exchange", disposition: "excluded" }),
  rule(700, { provider: "bank-a", sourceType: "Topup", descriptionMatch: "starts_with", matchValue: "top-up by *", disposition: "internal_transfer" }),
  rule(600, { provider: "bank-a", sourceType: "Topup", descriptionMatch: "word", matchValue: "salary", disposition: "income" }),
  rule(600, { provider: "bank-b", descriptionMatch: "contains", matchValue: "account holder", disposition: "internal_transfer" }),
  rule(500, { provider: "bank-b", descriptionMatch: "word", matchValue: "card-top", amountSign: "negative", disposition: "internal_transfer" }),
  rule(100, { provider: "bank-a", sourceType: "Topup", amountSign: "positive", disposition: "refund" }),
  rule(100, { provider: "bank-a", sourceType: "Topup", amountSign: "negative", disposition: "spend" }),
].toSorted((left, right) => right.priority - left.priority);

describe("transfer disposition rules", () => {
  const infer = (provider: string, sourceType: string, description: string, amountMinor: number) =>
    inferTransferDisposition({ provider, sourceType, description, amountMinor }, RULES);

  it("applies the first matching rule in priority order", () => {
    expect(infer("bank-a", "Topup", "Top-up by *3902", 3_000)).toBe("internal_transfer");
    expect(infer("bank-a", "Topup", "Monthly SALARY payment", 95_000)).toBe("income");
    expect(infer("bank-a", "Topup", "Refund from a shop", 800)).toBe("refund");
    expect(infer("bank-a", "Topup", "Card payment", -800)).toBe("spend");
    expect(infer("any-bank", "Exchange", "EUR to USD", -5_000)).toBe("excluded");
    expect(infer("bank-b", "Transfer", "To  Account Holder ", -1_000)).toBe("internal_transfer");
  });

  it("matches whole words and amount signs only", () => {
    expect(infer("bank-a", "Topup", "salaryman shop", 800)).toBe("refund");
    expect(infer("bank-b", "Card", "visa card-top 1234", 2_000)).toBeUndefined();
    expect(infer("bank-b", "Card", "visa card-top 1234", -2_000)).toBe("internal_transfer");
  });

  it("excludes zero amounts and leaves unmatched rows for review", () => {
    expect(infer("bank-a", "Topup", "Anything", 0)).toBe("excluded");
    expect(infer("unknown", "Transfer", "Mystery", 1_000)).toBeUndefined();
    expect(inferTransferDisposition({ provider: "bank-a", sourceType: "Topup", description: "Top-up by *1", amountMinor: 1 }, [])).toBeUndefined();
  });
});

describe("card funding pair rules", () => {
  const PAIR_RULES: readonly MoneyTransferPairRule[] = [
    { id: "to-wallet", debitProvider: "bank-b", debitSourceType: "CARD ABROAD", debitMatchValue: "wallet", creditProvider: "wallet", creditSourceType: "Topup" },
    { id: "to-broker", debitProvider: "bank-b", debitSourceType: "CARD ABROAD", debitMatchValue: "broker co", creditProvider: "broker", creditSourceType: "INPAYMENT" },
  ];
  const debit = (id: string, cardDate: string, destination = "wallet**4361* dublin", amountMinor = -25_000, lastFour = "6039"): CardFundingPairInput => ({
    id,
    accountId: "bank-account",
    provider: "bank-b",
    sourceType: "CARD ABROAD",
    description: `CARD ABROAD vom ${cardDate} valuta eur bei ${destination} carta n. 537572******${lastFour} - circuito mastercard`,
    localDate: "2026-06-08",
    amountMinor,
    currency: "EUR",
  });
  const credit = (id: string, date: string, provider = "wallet", amountMinor = 25_000, lastFour = "6039"): CardFundingPairInput => ({
    id,
    accountId: `${provider}-account`,
    provider,
    sourceType: provider === "wallet" ? "Topup" : "INPAYMENT",
    description: provider === "wallet" ? `Top-up by *${lastFour}` : `Card Top up with ****${lastFour}`,
    localDate: date,
    amountMinor,
    currency: "EUR",
  });

  it("uses the card purchase date to link settled debits with exact owned-account credits", () => {
    expect(matchCardFundingPairs([
      debit("to-wallet", "05/06/26"),
      credit("wallet-topup", "2026-06-05"),
      debit("to-broker", "25/11/24", "broker co berlin", -50_000),
      credit("broker-cash", "2024-11-25", "broker", 50_000),
    ], PAIR_RULES)).toEqual([
      ["to-wallet", "wallet-topup"],
      ["to-broker", "broker-cash"],
    ]);
  });

  it("keeps repeated amounts paired to their exact card dates", () => {
    expect(matchCardFundingPairs([
      debit("debit-june-four", "04/06/26"),
      debit("debit-june-five", "05/06/26"),
      credit("credit-june-five", "2026-06-05"),
      credit("credit-june-four", "2026-06-04"),
    ], PAIR_RULES)).toEqual([
      ["debit-june-four", "credit-june-four"],
      ["debit-june-five", "credit-june-five"],
    ]);
  });

  it("abstains when a candidate is ambiguous, evidence differs, or no rule names the destination", () => {
    expect(matchCardFundingPairs([debit("debit", "05/06/26"), credit("one", "2026-06-05"), credit("two", "2026-06-05")], PAIR_RULES)).toEqual([]);
    expect(matchCardFundingPairs([
      debit("debit", "05/06/26"),
      credit("wrong-date", "2026-06-06"),
      credit("wrong-card", "2026-06-05", "wallet", 25_000, "4492"),
      credit("wrong-amount", "2026-06-05", "wallet", 24_999),
      credit("wrong-destination", "2026-06-05", "broker"),
      { ...credit("wrong-currency", "2026-06-05"), currency: "USD" },
      { ...credit("same-account", "2026-06-05"), accountId: "bank-account" },
    ], PAIR_RULES)).toEqual([]);
    expect(matchCardFundingPairs([debit("debit", "05/06/26"), credit("credit", "2026-06-05")], [])).toEqual([]);
  });

  it("rejects duplicate debits and malformed card dates", () => {
    expect(matchCardFundingPairs([
      debit("debit-one", "05/06/26"),
      debit("debit-two", "05/06/26"),
      credit("credit", "2026-06-05"),
      debit("invalid-date", "31/02/26"),
      credit("other", "2026-02-31"),
    ], PAIR_RULES)).toEqual([]);
  });

  it("marks rule-backed rows as pairing candidates and keeps dated card debits out of generic matching", () => {
    const dated = debit("dated", "05/06/26");
    expect(isCardFundingDebit(dated, PAIR_RULES)).toBe(true);
    expect(isCardFundingDebit({ ...dated, description: "CARD ABROAD bei wallet" }, PAIR_RULES)).toBe(false);
    expect(isRuleTransferCandidate(credit("topup", "2026-06-05"), [], PAIR_RULES)).toBe(true);
    expect(isRuleTransferCandidate({ provider: "bank-b", sourceType: "Card", description: "to account holder", amountMinor: -10 }, RULES, [])).toBe(true);
    expect(isRuleTransferCandidate({ provider: "bank-b", sourceType: "Card", description: "coffee", amountMinor: -10 }, RULES, PAIR_RULES)).toBe(false);
  });
});
