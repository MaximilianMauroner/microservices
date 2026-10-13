import { moneyDisplayDescription } from "./money-description.js";
import type { MoneyCategory, MoneyTransferDisposition } from "./money-enums.js";
import type { MoneyFlowKind } from "./money-import-domain.js";
import { MONEY_TEXT_MATCHES, moneyTextMatcher, type MoneyTextMatch } from "./money-text-match.js";

export const MONEY_CATEGORY_RULE_FIELDS = ["description", "mcc", "source_type"] as const;
export type MoneyCategoryRuleField = typeof MONEY_CATEGORY_RULE_FIELDS[number];
export const MONEY_CATEGORY_RULE_OPERATORS = MONEY_TEXT_MATCHES;
export type MoneyCategoryRuleOperator = MoneyTextMatch;

/** What a stored rule matches and the category it sets. A missing account means every account. */
export type MoneyCategoryRuleDefinition = Readonly<{
  accountId?: string;
  matchField: MoneyCategoryRuleField;
  /** Merchant category codes and source types only use "equals". */
  matchOperator: MoneyCategoryRuleOperator;
  /** Normalized with normalizeCategoryRuleText. */
  matchValue: string;
  /** "uncategorized" keeps matching rows in the review queue and stops lower rules from matching them. */
  category: MoneyCategory;
}>;

/** The fields of a spending or refund row that rules can match. */
export type MoneyCategoryRuleSubject = Readonly<{ accountId: string; description: string; mcc?: string | null; sourceType: string }>;

/** Case, accents, known encoding damage, and repeated spaces do not change a match. */
export function normalizeCategoryRuleText(value: string) {
  return moneyDisplayDescription(value).toLocaleLowerCase("en-GB").normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
}

/** Finds the first matching rule. Rules must be sorted by priority, highest first. */
export function categoryRuleMatcher<Rule extends MoneyCategoryRuleDefinition>(rules: readonly Rule[]) {
  // Rules saved before normalization existed store lowercase text only.
  const compiled = rules.map((rule) => ({ rule, test: moneyTextMatcher(rule.matchOperator, normalizeCategoryRuleText(rule.matchValue)) }));
  return (subject: MoneyCategoryRuleSubject): Rule | undefined => {
    const text: Record<MoneyCategoryRuleField, string> = {
      description: normalizeCategoryRuleText(subject.description),
      mcc: normalizeCategoryRuleText(subject.mcc ?? ""),
      source_type: normalizeCategoryRuleText(subject.sourceType),
    };
    return compiled.find(({ rule, test }) => (rule.accountId === undefined || rule.accountId === subject.accountId) && test(text[rule.matchField]))?.rule;
  };
}

/** Rules decide spending and refunds, including unlinked transfers reviewed as spending or refunds. Other rows take the category their flow implies. */
export function isRuleCategorized(row: Readonly<{ flowKind: MoneyFlowKind; transferGroupId?: string | null; transferDisposition?: MoneyTransferDisposition | null }>) {
  if (row.flowKind === "spend" || row.flowKind === "refund") return true;
  return row.flowKind === "transfer" && !row.transferGroupId && (row.transferDisposition === "spend" || row.transferDisposition === "refund");
}
