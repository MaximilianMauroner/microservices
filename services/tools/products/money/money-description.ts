const MOJIBAKE = new Map([
  ["Ã", "Ä"], ["Ã", "Ö"], ["Ã", "Ü"], ["Ã¤", "ä"], ["Ã¶", "ö"], ["Ã¼", "ü"], ["Ã", "ß"],
  ["Ã", "É"], ["Ã©", "é"],
  ["â‚¬", "€"], ["â€™", "’"], ["â€“", "–"]
]);

/** Who the money went to or came from, and what kind of movement it was. */
export type MoneyTransactionSummary = Readonly<{ counterparty: string; detail?: string }>;

type SparkasseType = Readonly<{ label: string; counterparty?: (body: string) => string | undefined; reference?: (body: string) => string | undefined }>;

const transferParty = (body: string) => /^(.+?)\s+(?:iban\b|\[account\]|[a-z.]+:)/i.exec(body)?.[1];
const transferReference = (body: string) => /\bbeschreibung:\s+(.+?)(?:\s+(?:id\.|cro:|[a-z.]+:)|$)/i.exec(body)?.[1];

const SPARKASSE_TYPES: Readonly<Record<string, SparkasseType>> = {
  LASTSCHRIFT: {
    label: "Direct debit",
    counterparty: (body) => /(?:\[[^\]]+\]|\b[a-z]{2}\d{2}[a-z0-9]{3}\d+)\s+(.+?)\s+-\s+\d+/i.exec(body)?.[1],
    reference: (body) => {
      const period = /\babr\s+(\d{2})\.\s*(\d{2})\b/i.exec(body);
      return period ? billingMonth(Number(period[1]), Number(period[2])) : undefined;
    }
  },
  "BEZAHLUNG EU LAENDER": {
    label: "Card payment",
    counterparty: (body) => /\bbei\s+(.+?)\s+(?:carta|card|karte)\b/i.exec(body)?.[1]?.replace(/\*+\d+\*.*$/, "")
  },
  BEZUEGE: { label: "Salary", counterparty: transferParty, reference: transferReference },
  AUSGANGSBELEG: { label: "Incoming payment", counterparty: transferParty, reference: transferReference },
  HOMEBANKINGUEBERWEISUNG: { label: "Online transfer", counterparty: transferParty, reference: transferReference },
  UEBERWEISUNG: { label: "Transfer", counterparty: transferParty, reference: transferReference },
  "UEBERWEISUNG ZU IHREN GUNSTEN": { label: "Incoming transfer", counterparty: transferParty, reference: transferReference },
  "SEPA ECHTZEITUEBERWEISUNG": { label: "Instant transfer", counterparty: transferParty, reference: transferReference },
  "IHR DAUERAUFTRAG": { label: "Standing order", counterparty: transferParty, reference: transferReference },
  BAREINLAGE: { label: "Cash deposit" },
  "VERSCHIEDENE WERTE": { label: "Other movement", counterparty: transferParty, reference: transferReference },
  GEBUEHREN: { label: "Account fees" },
  "KOMMISSION AUF UEBERWEISUNGEN": { label: "Transfer fee" },
  "KOMM. ECHTZEITUEBERWEISUNG": { label: "Instant transfer fee" },
  STEMPELSTEUER: { label: "Stamp duty" }
};

/** Repairs known source-encoding artifacts without changing stored evidence. */
export function moneyDisplayDescription(description: string) {
  let value = description;
  for (const [broken, repaired] of MOJIBAKE) value = value.replaceAll(broken, repaired);
  return value;
}

/** Collapses provider noise that should not split one transfer-review decision. */
export function moneyTransferReviewDescription(description: string, sourceType: string) {
  const repaired = compact(description);
  if (sourceType === "BEZAHLUNG EU LAENDER") {
    if (/\bbei\s+revolut\b/i.test(repaired)) return "Revolut card funding";
    if (/\bbei\s+trade\s+republic\b/i.test(repaired)) return "Trade Republic funding";
  }
  return repaired;
}

/** Extracts the counterparty and the movement kind from a bank description. The full description stays the evidence. */
export function moneyTransactionSummary(description: string, sourceType = ""): MoneyTransactionSummary {
  const repaired = compact(description);
  const type = sourceType.toUpperCase();
  const known = SPARKASSE_TYPES[type];
  if (!known) return { counterparty: repaired || sourceType || "Unknown merchant" };
  const body = repaired.toUpperCase().startsWith(type) ? repaired.slice(type.length).trim() : repaired;
  const counterparty = known.counterparty?.(body)?.trim();
  if (!counterparty) return { counterparty: known.label };
  const reference = known.reference?.(body)?.trim();
  return { counterparty: titleCase(counterparty), detail: reference ? `${known.label} · ${reference}` : known.label };
}

/** A stable merchant label for grouping. */
export function moneyMerchantName(description: string, sourceType = "") {
  return moneyTransactionSummary(description, sourceType).counterparty;
}

function compact(description: string) {
  return moneyDisplayDescription(description).replace(/\s+/g, " ").trim();
}

function titleCase(value: string) {
  return value === value.toLowerCase() ? value.replace(/(^|[\s/-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase()) : value;
}

function billingMonth(month: number, year: number) {
  if (month < 1 || month > 12) return undefined;
  return new Date(Date.UTC(2000 + year, month - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
