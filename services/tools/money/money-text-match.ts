export const MONEY_TEXT_MATCHES = ["equals", "starts_with", "contains", "word"] as const;
export type MoneyTextMatch = typeof MONEY_TEXT_MATCHES[number];

/** Compiles one comparison against already normalized text. "word" needs a letter or digit boundary on both sides. */
export function moneyTextMatcher(match: MoneyTextMatch, value: string): (text: string) => boolean {
  if (match === "equals") return (text) => text === value;
  if (match === "starts_with") return (text) => text.startsWith(value);
  if (match === "contains") return (text) => text.includes(value);
  const word = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(value)}(?:$|[^\\p{L}\\p{N}])`, "u");
  return (text) => text.includes(value) && word.test(text);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
