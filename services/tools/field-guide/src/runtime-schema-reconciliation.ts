import type postgres from "postgres";

type ConstraintRow = Readonly<{ name: string; definition: string }>;

export function moneyImportConstraintRepairs(constraints: readonly ConstraintRow[]) {
  const definitions = new Map(constraints.map((constraint) => [constraint.name, constraint.definition]));
  return {
    provider: !definitions.get("money_accounts_provider_check")?.includes("'sparkasse'"),
    format: !definitions.get("money_imports_format_check")?.includes("'sparkasse_cash_statement_v1'"),
    category: !definitions.get("money_transactions_category_check")?.includes("'transfer'")
      || !definitions.get("money_transactions_category_check")?.includes("'adjustment'")
      || !definitions.get("money_transactions_category_check")?.includes("'personal_care'")
      || !definitions.get("money_category_rules_category_check")?.includes("'personal_care'"),
  };
}

/** Reconciles check expressions that Drizzle does not detect as schema changes. */
export async function reconcileRuntimeSchema(database: postgres.Sql) {
  await database.begin(async (transaction) => {
    const constraints = await transaction<ConstraintRow[]>`
      select conname name, pg_get_constraintdef(oid) definition
      from pg_constraint
      where conrelid in ('tools.money_accounts'::regclass, 'tools.money_imports'::regclass, 'tools.money_transactions'::regclass, 'tools.money_category_rules'::regclass)
        and conname in ('money_accounts_provider_check', 'money_imports_format_check', 'money_transactions_category_check', 'money_category_rules_category_check')`;
    const repairs = moneyImportConstraintRepairs(constraints);

    if (repairs.provider) {
      await transaction`alter table tools.money_accounts drop constraint if exists money_accounts_provider_check`;
      await transaction`alter table tools.money_accounts add constraint money_accounts_provider_check
        check (provider in ('revolut', 'portfolio_export', 'manual', 'sparkasse'))`;
    }
    if (repairs.format) {
      await transaction`alter table tools.money_imports drop constraint if exists money_imports_format_check`;
      await transaction`alter table tools.money_imports add constraint money_imports_format_check
        check (format in ('revolut_cash_statement_v1', 'revolut_trading_statement_v1', 'portfolio_transaction_export_v1', 'money_balance_snapshot_v1', 'sparkasse_cash_statement_v1'))`;
    }
    if (repairs.category) {
      await transaction`alter table tools.money_transactions drop constraint if exists money_transactions_category_check`;
      await transaction`alter table tools.money_transactions add constraint money_transactions_category_check
        check (category in ('housing', 'groceries', 'dining', 'transport', 'shopping', 'health', 'personal_care', 'travel', 'subscriptions', 'education', 'entertainment', 'gifts', 'taxes', 'fees', 'cash', 'investments', 'income', 'transfer', 'adjustment', 'other', 'uncategorized'))`;
      await transaction`alter table tools.money_category_rules drop constraint if exists money_category_rules_category_check`;
      await transaction`alter table tools.money_category_rules add constraint money_category_rules_category_check
        check (category in ('housing', 'groceries', 'dining', 'transport', 'shopping', 'health', 'personal_care', 'travel', 'subscriptions', 'education', 'entertainment', 'gifts', 'taxes', 'fees', 'cash', 'investments', 'income', 'transfer', 'adjustment', 'other', 'uncategorized'))`;
    }
  });
}
