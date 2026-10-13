import type { MoneyTrackerView } from "./money-tracker-navigation.js";
import { lazyRouteComponent } from "@tanstack/react-router";

export const MoneySpendingView = lazyRouteComponent(() => import("./money-spending-view.js"), "MoneySpendingView");
export const MoneyActivityView = lazyRouteComponent(() => import("./money-activity-view.js"), "MoneyActivityView");
export const MoneyInvestmentsView = lazyRouteComponent(() => import("./money-ledger-views.js"), "MoneyInvestmentsView");
export const MoneyReviewView = lazyRouteComponent(() => import("./money-review-view.js"), "MoneyReviewView");

/** Load view code alongside route data, including when a link is preloaded. */
export function preloadMoneyView(view: MoneyTrackerView) {
  switch (view) {
    case "spending": return MoneySpendingView.preload?.();
    case "transactions": return MoneyActivityView.preload?.();
    case "investments": return MoneyInvestmentsView.preload?.();
    case "review": return MoneyReviewView.preload?.();
    default: return Promise.resolve();
  }
}
