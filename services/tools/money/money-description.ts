const MOJIBAKE = new Map([
  ["Ã", "Ä"], ["Ã", "Ö"], ["Ã", "Ü"], ["Ã¤", "ä"], ["Ã¶", "ö"], ["Ã¼", "ü"], ["Ã", "ß"],
  ["â‚¬", "€"], ["â€™", "’"], ["â€“", "–"]
]);

/** Repairs known source-encoding artifacts without changing stored evidence. */
export function moneyDisplayDescription(description: string) {
  let value = description;
  for (const [broken, repaired] of MOJIBAKE) value = value.replaceAll(broken, repaired);
  return value;
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
