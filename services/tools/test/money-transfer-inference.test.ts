import { describe, expect, it } from "vitest";
import {
  inferTransferDisposition,
  matchSparkasseCardFundingPairs,
  type CardFundingPairInput,
} from "../money/money-transfer-inference.js";

describe("transfer disposition inference", () => {
  const infer = (
    provider: string,
    sourceType: string,
    description: string,
    amountMinor: number,
  ) =>
    inferTransferDisposition({
      provider,
      accountRole: "cash",
      sourceType,
      description,
      amountMinor,
    });

  it("recognizes owned-account funding independently from stored review", () => {
    expect(infer("revolut", "Topup", "Top-up by *3902", 3_000)).toBe(
      "internal_transfer",
    );
    expect(
      infer(
        "sparkasse",
        "BEZAHLUNG EU LAENDER",
        "bei Revolut**4361* Dublin",
        -25_000,
      ),
    ).toBe("internal_transfer");
    expect(
      infer("portfolio_export", "CUSTOMER_INBOUND", "UEBERWEISUNG", 50_000),
    ).toBe("internal_transfer");
  });

  it("classifies reviewed external flows from stable source evidence", () => {
    expect(
      infer("revolut", "Transfer", "Transfer from CHRISTIAN TUTZER", 800),
    ).toBe("refund");
    expect(
      infer("revolut", "Transfer", "Fitinn Wonic U4 Center Wie", -3_990),
    ).toBe("spend");
    expect(
      infer(
        "sparkasse",
        "UEBERWEISUNG",
        "Beschreibung: Gehalt Oktober",
        95_000,
      ),
    ).toBe("income");
    expect(
      infer("portfolio_export", "STOCKPERK", "Stockperk", 1_199),
    ).toBe("income");
  });

  it("leaves unsupported providers for review", () => {
    expect(infer("unknown", "Transfer", "Mystery", 1_000)).toBeUndefined();
  });
});

describe("Sparkasse card funding pair inference", () => {
  const debit = (
    id: string,
    cardDate: string,
    destination = "revolut**4361* dublin",
    amountMinor = -25_000,
    lastFour = "6039",
  ): CardFundingPairInput => ({
    id,
    accountId: "sparkasse-account",
    provider: "sparkasse",
    sourceType: "BEZAHLUNG EU LAENDER",
    description: `BEZAHLUNG EU LAENDER vom ${cardDate} valuta eur land irlanda bei ${destination} carta n. 537572******${lastFour} - circuito mastercard`,
    localDate: "2026-06-08",
    amountMinor,
    currency: "EUR",
  });
  const credit = (
    id: string,
    date: string,
    provider = "revolut",
    amountMinor = 25_000,
    lastFour = "6039",
  ): CardFundingPairInput => ({
    id,
    accountId: `${provider}-account`,
    provider,
    sourceType: provider === "revolut" ? "Topup" : "CUSTOMER_INPAYMENT",
    description: provider === "revolut" ? `Top-up by *${lastFour}` : `Card Top up with ****${lastFour}`,
    localDate: date,
    amountMinor,
    currency: "EUR",
  });

  it("uses the card purchase date to link settled debits with exact owned-account credits", () => {
    expect(matchSparkasseCardFundingPairs([
      debit("spark-revolut", "05/06/26"),
      credit("revolut-topup", "2026-06-05"),
      debit("spark-trade", "25/11/24", "trade republic berlin", -50_000),
      credit("trade-cash", "2024-11-25", "portfolio_export", 50_000),
    ])).toEqual([
      ["spark-revolut", "revolut-topup"],
      ["spark-trade", "trade-cash"],
    ]);
  });

  it("keeps repeated amounts paired to their exact card dates", () => {
    expect(matchSparkasseCardFundingPairs([
      debit("debit-june-four", "04/06/26"),
      debit("debit-june-five", "05/06/26"),
      credit("credit-june-five", "2026-06-05"),
      credit("credit-june-four", "2026-06-04"),
    ])).toEqual([
      ["debit-june-four", "credit-june-four"],
      ["debit-june-five", "credit-june-five"],
    ]);
  });

  it("abstains when an exact-date candidate is ambiguous or evidence differs", () => {
    expect(matchSparkasseCardFundingPairs([
      debit("debit", "05/06/26"),
      credit("candidate-one", "2026-06-05"),
      credit("candidate-two", "2026-06-05"),
    ])).toEqual([]);
    expect(matchSparkasseCardFundingPairs([
      debit("debit", "05/06/26"),
      credit("wrong-date", "2026-06-06"),
      credit("wrong-card", "2026-06-05", "revolut", 25_000, "4492"),
      credit("wrong-amount", "2026-06-05", "revolut", 24_999),
      credit("wrong-destination", "2026-06-05", "portfolio_export"),
      { ...credit("wrong-currency", "2026-06-05"), currency: "USD" },
      { ...credit("same-account", "2026-06-05"), accountId: "sparkasse-account" },
    ])).toEqual([]);
  });

  it("rejects duplicate debits and malformed card dates", () => {
    expect(matchSparkasseCardFundingPairs([
      debit("debit-one", "05/06/26"),
      debit("debit-two", "05/06/26"),
      credit("credit", "2026-06-05"),
      debit("invalid-date", "31/02/26"),
      credit("other", "2026-02-31"),
    ])).toEqual([]);
  });
});
