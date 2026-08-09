/** Browser-safe Money values shared by the importer and interactive ledger. */
export const MONEY_CATEGORIES = ["housing", "groceries", "dining", "transport", "shopping", "health", "travel", "subscriptions", "education", "entertainment", "gifts", "taxes", "fees", "cash", "investments", "income", "other", "uncategorized"] as const;
export type MoneyCategory = typeof MONEY_CATEGORIES[number];

export const MONEY_TRANSFER_DISPOSITIONS = ["internal_transfer", "income", "spend", "refund", "excluded"] as const;
export type MoneyTransferDisposition = typeof MONEY_TRANSFER_DISPOSITIONS[number];
