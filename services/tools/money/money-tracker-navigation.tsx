import { Link } from "@tanstack/react-router";

export const MONEY_VIEWS = ["overview", "spending", "transactions", "accounts", "investments", "plan", "review"] as const;
export type MoneyTrackerView = (typeof MONEY_VIEWS)[number];
export const MONEY_REVIEW_TABS = ["queue", "rules", "imports"] as const;
export type MoneyReviewTab = (typeof MONEY_REVIEW_TABS)[number];

const TITLES: Record<MoneyTrackerView, string> = {
  overview: "Overview",
  spending: "Spending",
  transactions: "Transactions",
  accounts: "Accounts",
  investments: "Investments",
  plan: "Plan",
  review: "Review",
};

export function moneyViewTitle(view: MoneyTrackerView) {
  return TITLES[view];
}

/** Rows that keep data out of the totals until someone reviews them. */
export function moneyReviewCount(counts: { uncategorized: number; transfers: number } | undefined) {
  return counts ? counts.uncategorized + counts.transfers : 0;
}

/** Reads the review counts from Money route loader data, which the workspace sidebar sees as unknown. */
export function moneyReviewCounts(loaderData: unknown) {
  if (typeof loaderData !== "object" || loaderData === null || !("reviewCounts" in loaderData)) return undefined;
  const counts = loaderData.reviewCounts;
  return typeof counts === "object" && counts !== null && "uncategorized" in counts && "transfers" in counts
    && typeof counts.uncategorized === "number" && typeof counts.transfers === "number"
    ? { uncategorized: counts.uncategorized, transfers: counts.transfers }
    : undefined;
}

/** Phone navigation. On wider screens the workspace sidebar lists the same views. */
export function MoneyNav({ current, reviewCount }: { current: MoneyTrackerView; reviewCount: number }) {
  return (
    <nav className="money-nav md:hidden" aria-label="Money">
      {MONEY_VIEWS.map((view) => (
        <Link
          key={view}
          to="/money"
          search={{ view: view === "overview" ? undefined : view }}
          preload="intent"
          activeOptions={{ exact: true, includeSearch: true }}
          aria-current={view === current ? "page" : undefined}
          className="money-nav__item"
        >
          {TITLES[view]}
          {view === "review" && reviewCount ? <MoneyReviewBadge count={reviewCount} /> : null}
        </Link>
      ))}
    </nav>
  );
}

export function MoneyReviewBadge({ count }: { count: number }) {
  return (
    <span className="money-review-badge" aria-label={`${count} to review`}>
      {count > 999 ? "999+" : count}
    </span>
  );
}
