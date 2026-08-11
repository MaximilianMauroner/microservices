/** Browser-safe Money values shared by the importer and interactive ledger. */
export const MONEY_CATEGORIES = ["housing", "groceries", "dining", "transport", "shopping", "health", "personal_care", "travel", "subscriptions", "education", "entertainment", "gifts", "taxes", "fees", "cash", "investments", "income", "transfer", "adjustment", "other", "uncategorized"] as const;
export type MoneyCategory = typeof MONEY_CATEGORIES[number];

export const MONEY_TRANSFER_DISPOSITIONS = ["internal_transfer", "income", "spend", "refund", "excluded"] as const;
export type MoneyTransferDisposition = typeof MONEY_TRANSFER_DISPOSITIONS[number];

export const REVOLUT_CASH_FORMAT = "revolut_cash_statement_v1" as const;
export const REVOLUT_TRADING_FORMAT = "revolut_trading_statement_v1" as const;
export const PORTFOLIO_TRANSACTION_FORMAT = "portfolio_transaction_export_v1" as const;
export const MONEY_BALANCE_SNAPSHOT_FORMAT = "money_balance_snapshot_v1" as const;
export const SPARKASSE_CASH_FORMAT = "sparkasse_cash_statement_v1" as const;
