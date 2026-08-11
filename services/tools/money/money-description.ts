const MOJIBAKE = new Map([
  ["Ã", "Ä"], ["Ã", "Ö"], ["Ã", "Ü"], ["Ã¤", "ä"], ["Ã¶", "ö"], ["Ã¼", "ü"], ["Ã", "ß"],
  ["Ã", "É"], ["Ã©", "é"],
  ["â‚¬", "€"], ["â€™", "’"], ["â€“", "–"]
]);

/** Repairs known source-encoding artifacts without changing stored evidence. */
export function moneyDisplayDescription(description: string) {
  let value = description;
  for (const [broken, repaired] of MOJIBAKE) value = value.replaceAll(broken, repaired);
  return value;
}

/** Collapses provider noise that should not split one transfer-review decision. */
export function moneyTransferReviewDescription(description: string, sourceType: string) {
  const repaired = moneyDisplayDescription(description).replace(/\s+/g, " ").trim();
  if (sourceType === "BEZAHLUNG EU LAENDER") {
    if (/\bbei\s+revolut\b/i.test(repaired)) return "Revolut card funding";
    if (/\bbei\s+trade\s+republic\b/i.test(repaired)) return "Trade Republic funding";
  }
  return repaired;
}

/** Produces a stable merchant label while retaining the exact transaction description separately. */
export function moneyMerchantName(description: string, sourceType = "") {
  const repaired = moneyDisplayDescription(description).replace(/\s+/g, " ").trim();
  if (!repaired) return sourceType || "Unknown merchant";

  if (/^LASTSCHRIFT\b/i.test(repaired)) {
    const payee = /\[[^\]]+\]\s+(.+?)\s+-\s+\d+\b/i.exec(repaired)?.[1]?.trim();
    if (payee) return payee;
  }

  if (/^BEZAHLUNG EU LAENDER\b/i.test(repaired)) {
    const merchant = /\bbei\s+(.+?)\s+(?:carta|card|karte)\b/i.exec(repaired)?.[1]?.trim();
    if (merchant) return merchant;
  }

  return repaired;
}
