import type { Sql, TransactionSql } from "postgres";
import { REVOLUT_CASH_FORMAT, REVOLUT_SAVINGS_FORMAT } from "./money-import-domain.js";

// A reverted Revolut row is a released authorization: it has no balance and never
// moved money. A later charge with the same start time is a separate completed row,
// so reverted rows are only left out and never cancel a completed row.
// A Revolut savings export row is hidden when the cash export has the same movement.
// The check builds a small id set, so callers' filters still reach the table scan.
export function effectiveTransactions(sql: Sql | TransactionSql) {
  return sql`with savings_duplicates as (
    select savings.id from tools.money_transactions savings
    join tools.money_imports savings_import on savings_import.id = savings.import_id and savings_import.format = ${REVOLUT_SAVINGS_FORMAT}
    join tools.money_transactions cash on cash.account_id = savings.account_id
      and cash.local_date = savings.local_date and cash.currency = savings.currency
      and cash.balance_after_minor = savings.balance_after_minor
      and cash.amount_minor - cash.fee_minor - cash.tax_minor = savings.amount_minor - savings.fee_minor - savings.tax_minor
      and cash.source_type = case when savings.source_type = 'Interest' then 'Interest' else 'Transfer' end
    join tools.money_imports cash_import on cash_import.id = cash.import_id and cash_import.format = ${REVOLUT_CASH_FORMAT}
    where savings.status = 'completed' and cash.status = 'completed'
  )
  select ledger.* from tools.money_transactions ledger
  where ledger.status = 'completed'
    and ledger.id not in (select id from savings_duplicates)`;
}

export function ledgerContributions(sql: Sql | TransactionSql) {
  return sql`with classified as (
    select effective.*, case
      when flow_kind = 'transfer' and transfer_group_id is not null then 'internal_transfer'
      when flow_kind = 'transfer' then coalesce(transfer_disposition, 'unreviewed')
      else flow_kind
    end effective_flow
    from (${effectiveTransactions(sql)}) effective
  ) select classified.*,
    case
      when effective_flow not in ('spend', 'refund') then 0
      when effective_flow = 'refund' or flow_kind = 'transfer' then -base_amount_minor
      else abs(base_amount_minor)
    end category_spend_minor
    from classified`;
}
