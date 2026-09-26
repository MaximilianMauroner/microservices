import type { MoneyTransferDisposition } from "./money-enums.js";

export const MONEY_TRANSFER_RULE_MATCHES = ["any", "equals", "starts_with", "contains", "word"] as const;
export type MoneyTransferRuleMatch = typeof MONEY_TRANSFER_RULE_MATCHES[number];
export const MONEY_TRANSFER_RULE_SIGNS = ["any", "positive", "negative"] as const;
export type MoneyTransferRuleSign = typeof MONEY_TRANSFER_RULE_SIGNS[number];

/** A stored rule. The first active match in priority order decides an unlinked transfer. */
export type MoneyTransferRule = Readonly<{
  id: string;
  priority: number;
  provider?: string;
  sourceType?: string;
  descriptionMatch: MoneyTransferRuleMatch;
  /** Lowercase text compared with the lowercase, trimmed description. */
  matchValue?: string;
  amountSign: MoneyTransferRuleSign;
  disposition: MoneyTransferDisposition;
  note?: string;
}>;

/** A stored rule: card debits that name a destination fund top-ups on that provider. */
export type MoneyTransferPairRule = Readonly<{
  id: string;
  debitProvider: string;
  debitSourceType: string;
  /** Lowercase word or phrase that names the destination in the debit description. */
  debitMatchValue: string;
  creditProvider: string;
  creditSourceType: string;
  note?: string;
}>;

export type MoneyTransferInferenceInput = Readonly<{
  provider: string;
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

type CardDebit = CardFundingPairInput & Readonly<{ cardDate: string; cardLastFour: string; rule: MoneyTransferPairRule }>;

/** Classifies an unlinked transfer with the stored rules; rules must be sorted by priority, highest first. */
export function inferTransferDisposition(
  input: MoneyTransferInferenceInput,
  rules: readonly MoneyTransferRule[],
): MoneyTransferDisposition | undefined {
  if (input.amountMinor === 0) return "excluded";
  return rules.find((rule) => transferRuleMatches(rule, input))?.disposition;
}

export function transferRuleMatches(rule: MoneyTransferRule, input: MoneyTransferInferenceInput) {
  if (rule.provider !== undefined && rule.provider !== input.provider) return false;
  if (rule.sourceType !== undefined && rule.sourceType !== input.sourceType) return false;
  if (rule.amountSign === "positive" && input.amountMinor <= 0) return false;
  if (rule.amountSign === "negative" && input.amountMinor >= 0) return false;
  return descriptionMatches(rule.descriptionMatch, rule.matchValue, normalizedDescription(input.description));
}

/** Rows a stored rule marks as own-account movements are candidates for amount and date pairing. */
export function isRuleTransferCandidate(
  row: MoneyTransferInferenceInput,
  rules: readonly MoneyTransferRule[],
  pairRules: readonly MoneyTransferPairRule[],
) {
  return pairRules.some((rule) => pairDebitMatches(rule, row) || (row.provider === rule.creditProvider && row.sourceType === rule.creditSourceType))
    || inferTransferDisposition(row, rules) === "internal_transfer";
}

/** Card debits with a purchase date are paired by card evidence only; settlement-date matching can pick the wrong top-up. */
export function isCardFundingDebit(row: MoneyTransferInferenceInput, pairRules: readonly MoneyTransferPairRule[]) {
  return purchaseDate(row.description) !== undefined && pairRules.some((rule) => pairDebitMatches(rule, row));
}

/** Pairs card funding on the original purchase date, not the bank settlement date. */
export function matchCardFundingPairs(
  rows: readonly CardFundingPairInput[],
  pairRules: readonly MoneyTransferPairRule[],
): Array<readonly [string, string]> {
  const debits = rows.flatMap((row): CardDebit[] => {
    if (row.amountMinor >= 0) return [];
    const rule = pairRules.find((candidate) => pairDebitMatches(candidate, row));
    const cardDate = purchaseDate(row.description);
    const cardLastFour = /\bcarta\s+n\.\s*\d{4,}\*+(\d{4})\b/i.exec(row.description)?.[1];
    return rule && cardDate && cardLastFour ? [{ ...row, cardDate, cardLastFour, rule }] : [];
  });
  const eligible = (debit: CardDebit, credit: CardFundingPairInput) =>
    credit.amountMinor > 0 && credit.provider === debit.rule.creditProvider && credit.sourceType === debit.rule.creditSourceType &&
    debit.accountId !== credit.accountId && debit.currency === credit.currency && -debit.amountMinor === credit.amountMinor &&
    credit.localDate === debit.cardDate && creditCardLastFour(credit.description) === debit.cardLastFour;
  const candidates = new Map(debits.map((debit) => [debit.id, rows.filter((credit) => eligible(debit, credit))]));
  return pairMutuallyUnique(debits, candidates);
}

function pairDebitMatches(rule: MoneyTransferPairRule, row: Pick<MoneyTransferInferenceInput, "provider" | "sourceType" | "description">) {
  return row.provider === rule.debitProvider && row.sourceType === rule.debitSourceType
    && descriptionMatches("word", rule.debitMatchValue, normalizedDescription(row.description));
}

function descriptionMatches(match: MoneyTransferRuleMatch, value: string | undefined, description: string) {
  if (match === "any") return true;
  if (value === undefined) return false;
  if (match === "equals") return description === value;
  if (match === "starts_with") return description.startsWith(value);
  if (match === "contains") return description.includes(value);
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(value)}(?:$|[^\\p{L}\\p{N}])`, "u").test(description);
}

function normalizedDescription(description: string) {
  return description.trim().toLocaleLowerCase("en-GB");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Sparkasse card statements record the purchase date as "vom DD/MM/YY". */
function purchaseDate(description: string) {
  const match = /\bvom\s+(\d{2})\/(\d{2})\/(\d{2})\b/i.exec(description);
  if (!match) return undefined;
  const date = `20${match[3]}-${match[2]}-${match[1]}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : undefined;
}

/** Revolut and Trade Republic top-ups name the funding card as "*1234". */
function creditCardLastFour(description: string) {
  return /(?:top-up by|card top up with)\s+\*+(\d{4})\b/i.exec(description)?.[1];
}

function pairMutuallyUnique(debits: readonly CardDebit[], candidates: ReadonlyMap<string, readonly CardFundingPairInput[]>) {
  const debitCountByCredit = new Map<string, number>();
  for (const options of candidates.values()) {
    for (const credit of options) debitCountByCredit.set(credit.id, (debitCountByCredit.get(credit.id) ?? 0) + 1);
  }
  const used = new Set<string>();
  const pairs: Array<readonly [string, string]> = [];
  for (const debit of debits) {
    const options = candidates.get(debit.id) ?? [];
    if (options.length !== 1 || debitCountByCredit.get(options[0]!.id) !== 1 || used.has(debit.id) || used.has(options[0]!.id)) continue;
    used.add(debit.id);
    used.add(options[0]!.id);
    pairs.push([debit.id, options[0]!.id]);
  }
  return pairs;
}
