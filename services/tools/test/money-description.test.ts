import { describe, expect, it } from "vitest";
import { moneyDisplayDescription, moneyMerchantName } from "../money/money-description.js";

describe("money descriptions", () => {
  it("repairs known mojibake for display while leaving the stored source untouched", () => {
    const source = "ÃBB Ticket";
    expect(moneyDisplayDescription(source)).toBe("ÖBB Ticket");
    expect(source).toBe("ÃBB Ticket");
  });

  it("groups common bank descriptions by merchant instead of reference noise", () => {
    expect(moneyMerchantName("LASTSCHRIFT [DE12] ACME MARKET - 123456789")).toBe("ACME MARKET");
    expect(moneyMerchantName("BEZAHLUNG EU LAENDER bei CORNER SHOP carta 1234")).toBe("CORNER SHOP");
  });
});
