/** Net-worth snapshots are now owned by the Money Postgres domain. */
export type MoneyTrackerSnapshot = Readonly<{
  accounts: string[];
  accountLabels: Record<string, string>;
  months: Array<{
    date: string;
    total: number;
    values: Record<string, number>;
  }>;
  latestDate?: string;
}>;
