import type { MoneyTrackerView } from "./money-tracker-navigation.js";

export const loadMoneySpendingView = () => import("./money-spending-view.js");
export const loadMoneyActivityView = () => import("./money-activity-view.js");
export const loadMoneyInvestmentsView = () => import("./money-ledger-views.js");
export const loadMoneyReviewView = () => import("./money-review-view.js");

/** Load view code alongside route data, including when a link is preloaded. */
export function preloadMoneyView(view: MoneyTrackerView) {
  switch (view) {
    case "spending": return loadMoneySpendingView();
    case "transactions": return loadMoneyActivityView();
    case "investments": return loadMoneyInvestmentsView();
    case "review": return loadMoneyReviewView();
    default: return Promise.resolve();
  }
}
