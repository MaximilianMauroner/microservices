import type postgres from "postgres";

type ConstraintRow = Readonly<{ name: string; definition: string }>;

export function moneyImportConstraintRepairs(constraints: readonly ConstraintRow[]) {
  const definitions = new Map(constraints.map((constraint) => [constraint.name, constraint.definition]));
  return {
    provider: !definitions.get("money_accounts_provider_check")?.includes("'sparkasse'"),
    format: !definitions.get("money_imports_format_check")?.includes("'sparkasse_cash_statement_v1'"),
  };
}

/** Reconciles check expressions that Drizzle does not detect as schema changes. */
export async function reconcileRuntimeSchema(database: postgres.Sql) {
  await database.begin(async (transaction) => {
    const constraints = await transaction<ConstraintRow[]>`
      select conname name, pg_get_constraintdef(oid) definition
      from pg_constraint
      where conrelid in ('tools.money_accounts'::regclass, 'tools.money_imports'::regclass)
        and conname in ('money_accounts_provider_check', 'money_imports_format_check')`;
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
  });
}
