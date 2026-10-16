# Money

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| W1 | In Money, preview and import a synthetic supported CSV. Confirm balances and transactions; reimport the same file without duplicates. Edit category and transfer classification and inspect the review queue. Delete the import and confirm dependent totals change correctly. | src/routes/api/money/imports; test/money-import.test.ts; test/sparkasse-import.test.ts; test/money-transfer-inference.test.ts | Isolated PostgreSQL, synthetic CSV. Use import deletion, not direct SQL. |
| W2 | Visit Overview, Spending, Transactions, Accounts, Investments, Plan, and Review with owned records. Change date range, category, and account filters; inspect matching totals and rows. Complete a review/check-in and reload to verify persistence. Inspect allocations and forecasts against owned input. | src/routes/money.tsx; test/money-views.test.tsx; test/money-checkin-card.test.tsx; test/money-predictions.test.ts | W1 data, local market-data fixtures configured through supported setup. No paid or production market-data request. Remove owned records. |
