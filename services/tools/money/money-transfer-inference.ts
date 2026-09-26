import type { MoneyTransferDisposition } from "./money-enums.js";

export type MoneyTransferInferenceInput = Readonly<{
  provider: string;
  accountRole: "cash" | "investment";
  sourceType: string;
  description: string;
  amountMinor: number;
}>;

export type CardFundingPairInput = Readonly<{
  id: string;
  accountId: string;
  provider: string;
  sourceType: string;
  description: string;
  localDate: string;
  amountMinor: number;
  currency: string;
}>;

type CardDebit = CardFundingPairInput & Readonly<{
  cardDate: string;
  destination: "revolut" | "portfolio_export";
  cardLastFour: string;
}>;

/** Pair card funding on the original purchase date, not the bank settlement date. */
export function matchSparkasseCardFundingPairs(
  rows: readonly CardFundingPairInput[],
): Array<readonly [string, string]> {
  const debits = rows.flatMap((row): CardDebit[] => {
    if (row.provider !== "sparkasse" || row.sourceType !== "BEZAHLUNG EU LAENDER" || row.amountMinor >= 0) return [];
    const description = row.description.toLocaleLowerCase("en-GB");
    const date = /\bvom\s+(\d{2})\/(\d{2})\/(\d{2})\b/.exec(description);
    const card = /\bcarta\s+n\.\s*\d{4,}\*+(\d{4})\b/.exec(description);
    const destination = /\bbei\s+trade republic\b/.test(description) ? "portfolio_export"
      : /\bbei\s+revolut\b/.test(description) ? "revolut" : undefined;
    if (!date || !card || !destination) return [];
    const cardDate = `20${date[3]}-${date[2]}-${date[1]}`;
    const parsedDate = new Date(`${cardDate}T00:00:00Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== cardDate) return [];
    return [{ ...row, cardDate, cardLastFour: card[1]!, destination }];
  });
  const credits = rows.filter((row) => row.amountMinor > 0 && (
    (row.provider === "revolut" && row.sourceType === "Topup") ||
    (row.provider === "portfolio_export" && row.sourceType === "CUSTOMER_INPAYMENT")
  ));
  const eligible = (debit: CardDebit, credit: CardFundingPairInput) =>
    debit.destination === credit.provider && debit.accountId !== credit.accountId &&
    debit.currency === credit.currency && -debit.amountMinor === credit.amountMinor &&
    credit.localDate === debit.cardDate &&
    cardFundingLastFour(credit.description) === debit.cardLastFour;

  const exact = new Map(debits.map((debit) => [debit.id, credits.filter((credit) => eligible(debit, credit))]));
  const used = new Set<string>();
  const pairs: Array<readonly [string, string]> = [];
  pairMutuallyUnique(debits, exact, used, pairs);
  return pairs;
}

function cardFundingLastFour(description: string): string | undefined {
  return /(?:top-up by|card top up with)\s+\*+(\d{4})\b/i.exec(description)?.[1];
}

function pairMutuallyUnique(
  debits: readonly CardDebit[],
  candidates: ReadonlyMap<string, readonly CardFundingPairInput[]>,
  used: Set<string>,
  pairs: Array<readonly [string, string]>,
) {
  const debitCountByCredit = new Map<string, number>();
  for (const options of candidates.values()) {
    for (const credit of options) debitCountByCredit.set(credit.id, (debitCountByCredit.get(credit.id) ?? 0) + 1);
  }
  for (const debit of debits) {
    const options = candidates.get(debit.id) ?? [];
    if (options.length !== 1 || debitCountByCredit.get(options[0]!.id) !== 1 || used.has(debit.id) || used.has(options[0]!.id)) continue;
    used.add(debit.id);
    used.add(options[0]!.id);
    pairs.push([debit.id, options[0]!.id]);
  }
}

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
