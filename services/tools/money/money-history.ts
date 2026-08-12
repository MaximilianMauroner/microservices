import type { MoneyTrackerPageData } from "../src/protected-data.js";

export type Month = MoneyTrackerPageData["months"][number];
export type GroupedMonth = Month & {
  money: number;
  stocks: number;
  trend: number;
  observed?: boolean;
  portfolioDate?: string;
};

export function groupMonth(
  month: Month,
  roles: Record<string, "cash" | "investment">
): GroupedMonth {
  let money = 0;
  let stocks = 0;
  for (const [account, value] of Object.entries(month.values)) {
    if (roles[account] === "investment") stocks += value;
    else money += value;
  }
  return { ...month, money, stocks, trend: month.total };
}
