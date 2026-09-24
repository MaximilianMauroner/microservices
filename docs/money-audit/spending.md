# Spending and category audit

Status: **awaiting a safe copy of the Money database**. No transaction or rule changes have been made. No row-level category recommendations can be assigned a meaningful confidence score yet.

## Data access checked on 2026-09-24

- `services/tools/.env.local` has a `DATABASE_URL` whose host is a Railway proxy. Repository instructions forbid pointing a local process at production data, so it was not contacted.
- PostgreSQL is listening locally, but the repository's `local/local` Compose credentials failed. The accessible local cluster contains no Money database or `tools.money_transactions` table. Docker is unavailable in this environment.
- The supplied screen shows **43 uncategorized spending rows**. This is a screen count, not a verified database total or a list of identifiable transactions.

## What needs review when a safe snapshot is available

Review every completed effective transaction alongside its account (`tools.money_accounts`), import, category, `category_origin`, `flow_kind`, transfer disposition, description, source type, and MCC. Reverted rows must be retained for provenance but excluded from current spending totals. Then inspect every active and inactive row in `tools.money_category_rules`, including rule priority and all matching historical rows.

| Check | Evidence needed | Proposed handling |
| --- | --- | --- |
| Uncategorized spending | Row IDs, merchant descriptions, MCC, source type, account, amount, date, recurring peers | Recommend a category for each row with a separate confidence score. |
| Existing categories | Repeated merchant rows and their category origins | Flag mismatched categories, especially one merchant split across categories without a clear reason. Preserve direct manual edits pending review. |
| Existing rules | Rule ID, account ID, field, normalized value, priority, active state, matched row IDs | Flag broad or conflicting matches and rules whose outcomes disagree with reviewed rows. |
| Candidate rules | Exact historical match set, affected categories, outliers, total amounts | Prefer account-scoped exact description or MCC rules. Require preview and individual approval before applying. |
| Flow versus category | `flow_kind`, sign, category, transfer state | Flag spend/income/refund/fee rows whose category appears inconsistent with their flow; hand possible transfer errors to the transfer audit. |

## Recommendation ledger

No row-level recommendations yet. The available evidence does not include transaction IDs or historical data. The following template should be filled for **each** proposed change after the safe snapshot is read:

| Proposal ID | Transaction IDs | Account | Current state | Proposed state | Evidence and reasoning | Matching rule / affected rows | Confidence | Approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

Confidence should mean: **high** when merchant/MCC and recurring history consistently support one category; **medium** when the merchant is clear but the purchase purpose varies; **low** when descriptions are generic or no corroborating history exists; **guess** when the proposed category rests only on a weak name inference. No unverified item should be marked high confidence.

## Rule behavior observed in code

The existing category rule table is account scoped and supports exact lowercase `description`, exact `mcc`, or lowercase `source_type` matches. Active rules are applied by descending priority, then rule ID. The current single-row action can create an exact-description rule and propagate it to rows without manual category origin. Deleting a rule resets its rule-derived rows to uncategorized before reapplying other matches. A review builder should preview the full match set and any overlap before saving or applying a proposed rule.

Sources: `services/tools/database/postgres-schema.ts`, `services/tools/money/money-repository.ts`, and `services/tools/test/money-repository.integration.test.ts`.
