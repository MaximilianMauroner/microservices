import type { MoneyTransferDisposition } from "./money-enums.js";

export type MoneyTransferInferenceInput = Readonly<{
  provider: string;
  accountRole: "cash" | "investment";
  sourceType: string;
  description: string;
  amountMinor: number;
}>;

/** Classifies only transfer evidence that remains valid after a fresh import. */
export function inferTransferDisposition(
  input: MoneyTransferInferenceInput,
): MoneyTransferDisposition | undefined {
  const description = input.description.trim().toLocaleLowerCase("en-GB");

  if (input.amountMinor === 0 || input.sourceType === "Exchange") {
    return "excluded";
  }

  if (input.provider === "portfolio_export") {
    if (input.sourceType === "STOCKPERK") return "income";
    if (
      input.sourceType === "CUSTOMER_INBOUND" ||
      input.sourceType === "CUSTOMER_INPAYMENT"
    ) {
      return "internal_transfer";
    }
  }

  if (input.provider === "revolut") {
    if (
      input.sourceType === "CASH TOP-UP" ||
      input.sourceType === "CASH WITHDRAWAL" ||
      input.sourceType ===
        "TRANSFER FROM REVOLUT BANK UAB TO REVOLUT SECURITIES EUROPE UAB"
    ) {
      return "internal_transfer";
    }
    if (
      input.sourceType ===
      "TRANSFER FROM REVOLUT TRADING LTD TO REVOLUT SECURITIES EUROPE UAB"
    ) {
      return "excluded";
    }
    if (input.sourceType === "Card Payment" && description === "hype") {
      return "internal_transfer";
    }
    if (input.sourceType === "Topup") {
      if (
        /^top-up by \*/.test(description) ||
        description === "payment from mauroner maximilian"
      ) {
        return "internal_transfer";
      }
      if (isIncome(description)) return "income";
      return input.amountMinor > 0 ? "refund" : "spend";
    }
    if (input.sourceType === "Transfer") {
      if (
        description === "to maximilian mauroner" ||
        description === "to sparkasse" ||
        description === "to investment account" ||
        description === "revolut bank uab" ||
        description === "revolut payments uab"
      ) {
        return "internal_transfer";
      }
      return input.amountMinor > 0 ? "refund" : "spend";
    }
  }

  if (input.provider === "sparkasse") {
    if (
      input.sourceType === "BAREINLAGE" ||
      input.sourceType === "VERSCHIEDENE WERTE"
    ) {
      return "excluded";
    }
    if (
      input.sourceType === "BEZAHLUNG EU LAENDER" &&
      /\b(revolut|trade republic)\b/.test(description)
    ) {
      return "internal_transfer";
    }
    if (
      input.sourceType === "HOMEBANKINGUEBERWEISUNG" ||
      description.includes("maximilian mauroner")
    ) {
      return "internal_transfer";
    }
    if (input.amountMinor > 0) {
      return isIncome(description) ? "income" : "refund";
    }
  }

  return undefined;
}

function isIncome(description: string) {
  return /provincia autonoma bolzano|\bgehalt\b|\bgewinnbeteiligung\b|\bweihnachten\b|\bunterstuetzung\b|\brimborso irpef\b|beschreibung: heim april\/mai|beschreibung: anzahlung/.test(
    description,
  );
}
