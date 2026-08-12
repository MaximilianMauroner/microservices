import { Link } from "@tanstack/react-router";

export type MoneyTrackerView = "overview" | "cash-flow" | "transactions" | "investments" | "accounts" | "categories" | "insights" | "predictions" | "data";

export function moneyViewTitle(view: MoneyTrackerView) {
  return view === "overview" ? "Overview" : view === "cash-flow" ? "Cash flow" : view === "transactions" ? "Transactions" : view === "investments" ? "Investments" : view === "accounts" ? "Accounts" : view === "categories" ? "Categories" : view === "insights" ? "Insights" : view === "predictions" ? "Predictions" : "Data quality";
}

export function MoneyNav() {
  return <nav className="money-nav" aria-label="Money"><NavGroup label="Portfolio"><NavItem view="overview">Overview</NavItem><NavItem view="accounts">Accounts</NavItem><NavItem view="investments">Investments</NavItem></NavGroup><NavGroup label="Operations"><NavItem view="cash-flow">Cash flow</NavItem><NavItem view="transactions">Transactions</NavItem></NavGroup><NavGroup label="Analysis"><NavItem view="categories">Categories</NavItem><NavItem view="insights">Insights</NavItem><NavItem view="predictions">Predictions</NavItem></NavGroup><NavGroup label="System"><NavItem view="data">Data quality</NavItem></NavGroup></nav>;
}

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="money-nav__group"><span className="money-nav__label">{label}</span>{children}</div>;
}

function NavItem({ view, children }: { view: MoneyTrackerView; children: React.ReactNode }) {
  return <Link to="/money" search={{ view: view === "overview" ? undefined : view }} preload="intent" activeOptions={{ exact: true }} className="money-nav__item">{children}</Link>;
}
