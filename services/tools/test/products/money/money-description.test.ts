import { describe, expect, it } from "vitest";
import { moneyDisplayDescription, moneyMerchantName, moneyTransactionSummary, moneyTransferReviewDescription } from "../../../products/money/money-description.js";

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
    expect(moneyMerchantName("LASTSCHRIFT [DE12] ACME MARKET - 123456789", "LASTSCHRIFT")).toBe("ACME MARKET");
    expect(moneyMerchantName("BEZAHLUNG EU LAENDER bei CORNER SHOP carta 1234", "BEZAHLUNG EU LAENDER")).toBe("CORNER SHOP");
  });

  it("summarizes Sparkasse direct debits by creditor and billing month", () => {
    const stored = "LASTSCHRIFT core rcur prg.car.: 100000000000001 75750 example, max [account] stiftung - 610983 rn..................000757 50 bn 10000001/01.10.26 abr 10.26 - bkauatwwxxx";
    const raw = "LASTSCHRIFT core rcur prg.car.: 100000000000002 75750 example, max at00zzz00000000001 stud entenheim stiftung - 610983 rn... ...............00075750 bn 10000002/01.09.26 abr 09. 26 - bkauatwwxxx";
    expect(moneyTransactionSummary(stored, "LASTSCHRIFT")).toEqual({ counterparty: "Stiftung", detail: "Direct debit · Oct 2026" });
    expect(moneyTransactionSummary(raw, "LASTSCHRIFT")).toEqual({ counterparty: "Stud Entenheim Stiftung", detail: "Direct debit · Sep 2026" });
  });

  it("summarizes Sparkasse card payments, salaries, transfers, and fees", () => {
    expect(moneyTransactionSummary("BEZAHLUNG EU LAENDER vom 20/10/26 valuta eur land irlanda bei revolut**1234* dubli carta n. 500000******0000 - circuito mastercard", "BEZAHLUNG EU LAENDER"))
      .toEqual({ counterparty: "Revolut", detail: "Card payment" });
    expect(moneyTransactionSummary("BEZUEGE acme s.r.l. verrechnungsdatum: 05/11/26 id.zahler: [account] auftraggeberbank: 00000/00000-exampleitxx cro: 0000000000000000000000000000it00000 beschreibung: ottobre 2026 id.zahler: 00000000000 id. ueberweisung: 200000000", "BEZUEGE"))
      .toEqual({ counterparty: "Acme S.r.l.", detail: "Salary · ottobre 2026" });
    expect(moneyTransactionSummary("HOMEBANKINGUEBERWEISUNG example universitaet wien iban beg.: [account] empfaengerbank: exampleatxx auftragsdatum: 31/08/26", "HOMEBANKINGUEBERWEISUNG"))
      .toEqual({ counterparty: "Example Universitaet Wien", detail: "Online transfer" });
    expect(moneyTransactionSummary("GEBUEHREN", "GEBUEHREN")).toEqual({ counterparty: "Account fees" });
  });

  it("keeps descriptions from providers without a known layout", () => {
    expect(moneyTransactionSummary("Transfer from CHRISTIAN TUTZER", "Transfer")).toEqual({ counterparty: "Transfer from CHRISTIAN TUTZER" });
  });

  it("groups recurring card funding despite changing dates, countries, and masked cards", () => {
    const ireland = "BEZAHLUNG EU LAENDER vom 04/06/26 valuta eur land irlanda bei revolut**4492 carta 1234";
    const lithuania = "BEZAHLUNG EU LAENDER vom 06/04/25 valuta eur land lituania bei revolut**6039 carta 5678";
    expect(moneyTransferReviewDescription(ireland, "BEZAHLUNG EU LAENDER")).toBe("Revolut card funding");
    expect(moneyTransferReviewDescription(lithuania, "BEZAHLUNG EU LAENDER")).toBe("Revolut card funding");
    expect(moneyTransferReviewDescription("Transfer from CHRISTIAN TUTZER", "Transfer")).toBe("Transfer from CHRISTIAN TUTZER");
  });
});
