import { describe, expect, it } from "vitest";
import { inferTransferDisposition } from "../money/money-transfer-inference.js";

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
