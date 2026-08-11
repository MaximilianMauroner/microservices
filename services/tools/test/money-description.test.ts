import { describe, expect, it } from "vitest";
import { moneyDisplayDescription, moneyMerchantName, moneyTransferReviewDescription } from "../money/money-description.js";

describe("money descriptions", () => {
  it("repairs known mojibake for display while leaving the stored source untouched", () => {
    const source = "ÃBB Ticket";
    expect(moneyDisplayDescription(source)).toBe("ÖBB Ticket");
    expect(source).toBe("ÃBB Ticket");
  });

  it("repairs accented merchant names", () => {
    expect(moneyDisplayDescription("CafÃ© Jelinek")).toBe("Café Jelinek");
    expect(moneyDisplayDescription("CAFÃ CENTRAL")).toBe("CAFÉ CENTRAL");
    expect(moneyMerchantName("CafÃ© Jelinek")).toBe("Café Jelinek");
  });

  it("groups common bank descriptions by merchant instead of reference noise", () => {
    expect(moneyMerchantName("LASTSCHRIFT [DE12] ACME MARKET - 123456789")).toBe("ACME MARKET");
    expect(moneyMerchantName("BEZAHLUNG EU LAENDER bei CORNER SHOP carta 1234")).toBe("CORNER SHOP");
  });

  it("groups recurring card funding despite changing dates, countries, and masked cards", () => {
    const ireland = "BEZAHLUNG EU LAENDER vom 04/06/26 valuta eur land irlanda bei revolut**4492 carta 1234";
    const lithuania = "BEZAHLUNG EU LAENDER vom 06/04/25 valuta eur land lituania bei revolut**6039 carta 5678";
    expect(moneyTransferReviewDescription(ireland, "BEZAHLUNG EU LAENDER")).toBe("Revolut card funding");
    expect(moneyTransferReviewDescription(lithuania, "BEZAHLUNG EU LAENDER")).toBe("Revolut card funding");
    expect(moneyTransferReviewDescription("Transfer from CHRISTIAN TUTZER", "Transfer")).toBe("Transfer from CHRISTIAN TUTZER");
  });
});
