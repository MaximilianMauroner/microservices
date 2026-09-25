# Money transfer audit

The full row-level audit from the authorized database export is stored privately at `.scratch/money-audit/transfers-audit.md`. It proposes two replacements for likely incorrect links and 30 candidate pairs for previously unlinked transfers. Each proposal includes record IDs, current and proposed state, evidence, confidence, and approval dependencies.

The private [recommendations index](../../.scratch/money-audit/recommendations.md) and [complete ledger](../../.scratch/money-audit/ledger.md) contain financial details. They are ignored by Git and should stay local. No database record was changed during the audit.
