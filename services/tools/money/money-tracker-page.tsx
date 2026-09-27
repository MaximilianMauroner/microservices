"use client";

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Upload } from "lucide-react";
import type { MoneyTrackerPageData } from "../src/protected-data.js";
import {
  moneyFinancialHistory,
  moneyFinancialPosition,
  moneyTrackerTrendStats,
} from "./money-tracker-domain.js";
import { AppShell } from "../src/components/app-shell.js";
import { favicons } from "../src/favicons.js";
import { Badge } from "../src/components/ui/badge.js";
import { Button, buttonVariants } from "../src/components/ui/button.js";
import { Card } from "../src/components/ui/card.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../src/components/ui/sheet.js";
import type { MoneyCategory } from "./money-enums.js";
import type { MoneyActivityPage } from "./money-repository.js";
import { groupMonth, type GroupedMonth, type Month } from "./money-history.js";
import { MoneyCheckInBridge } from "./money-checkin-card.js";
import { BalanceForm } from "./money-balance-form.js";
import { moneyCategoryLabel } from "./money-category-picker.js";
import { projectMoneyTrajectory } from "./money-plan-domain.js";
import {
  MoneyNav,
  moneyReviewCount,
  moneyViewTitle,
  type MoneyReviewTab,
  type MoneyTrackerView,
} from "./money-tracker-navigation.js";
import {
  BulletBar,
  EmptyState,
  FanChart,
  type FanPoint,
  FlowChart,
  formatCompact,
  formatDay,
  formatEuro,
  formatMinor,
  formatMonth,
  formatRatio,
  Legend,
  LegendItem,
  LineTrendChart,
  MoneyPanel,
  PanelBody,
  PanelFooter,
  flowTooltip,
  Segmented,
  SERIES,
  SparkLine,
  Stat,
  StatStrip,
  TableTwin,
  toneClass,
} from "./money-ui.js";

export type { MoneyTrackerView } from "./money-tracker-navigation.js";
type Period = "6m" | "1y" | "5y" | "all";

const MoneySpendingView = lazy(async () => ({ default: (await import("./money-spending-view.js")).MoneySpendingView }));
const MoneyActivityView = lazy(async () => ({ default: (await import("./money-ledger-views.js")).MoneyActivityView }));
const MoneyInvestmentsView = lazy(async () => ({ default: (await import("./money-ledger-views.js")).MoneyInvestmentsView }));
const MoneyReviewView = lazy(async () => ({ default: (await import("./money-review-view.js")).MoneyReviewView }));

const SUBTITLES: Record<MoneyTrackerView, string> = {
  overview: "Net worth, what changed, and where it is going",
  spending: "Income, spending, and categories by month",
  transactions: "Every imported row. Change a category in its row",
  accounts: "Balances and how current they are",
  investments: "Positions, prices, and gains",
  plan: "A projection from your own history, not a promise",
  review: "Everything that keeps rows out of your totals",
};

export function MoneyTrackerPage(
  props: MoneyTrackerPageData & {
    view: MoneyTrackerView;
    tab?: MoneyReviewTab;
    category?: MoneyCategory;
    review?: boolean;
    fromMonth?: string;
    toMonth?: string;
  },
) {
  const reviewCount = moneyReviewCount(props.reviewCounts);
  return (
    <>
      <AppShell product="Money" accent="lime" icon={favicons.money} />
      <main id="main" className="money-page">
        <MoneyNav current={props.view} reviewCount={reviewCount} />
        <header className="money-heading">
          <div>
            <h1>{moneyViewTitle(props.view)}</h1>
            <p>{SUBTITLES[props.view]}</p>
          </div>
          {props.view === "review" ? null : (
            <div className="money-heading__actions">
              <Link to="/money" search={{ view: "review", tab: "imports" }} className={buttonVariants({ variant: "outline", size: "sm" })}>
                <Upload />
                Import
              </Link>
            </div>
          )}
        </header>
        <Suspense fallback={<MoneyPanel><EmptyState title="Loading view" /></MoneyPanel>}>
          <MoneyView {...props} />
        </Suspense>
      </main>
    </>
  );
}

function MoneyView(props: Parameters<typeof MoneyTrackerPage>[0]) {
  switch (props.view) {
    case "overview":
      return <Overview {...props} />;
    case "spending":
      return <MoneySpendingView spending={props.spending} transferReview={props.transferReview} reviewCounts={props.reviewCounts} initialCategory={props.category} />;
    case "transactions":
      return (
        <MoneyActivityView
          activity={props.activity}
          accounts={props.accounts}
          accountLabels={props.accountLabels}
          transactionCount={props.transactionCount}
          reviewCounts={props.reviewCounts}
          initialCategory={props.category}
          initialReviewOnly={props.review}
          initialFromMonth={props.fromMonth}
          initialToMonth={props.toMonth}
        />
      );
    case "accounts":
      return <Accounts {...props} />;
    case "investments":
      return <MoneyInvestmentsView investments={props.investments} marketData={props.marketData} checkIn={props.checkIn} />;
    case "plan":
      return <Plan {...props} />;
    case "review":
      return <MoneyReviewView {...props} tab={props.tab ?? "queue"} />;
  }
}

/* ---------- Shared history ---------- */

/** Monthly cash plus the portfolio value on each month end, as one series. */
function useFinancialHistory(props: MoneyTrackerPageData) {
  const cashAccounts = useMemo(() => props.accounts.filter((account) => props.accountRoles[account] !== "investment"), [props.accountRoles, props.accounts]);
  const cashMonths = useMemo(() => props.months.map((month) => cashMonth(month, cashAccounts)), [cashAccounts, props.months]);
  const months = useMemo(() => {
    const financial = moneyFinancialHistory(
      cashMonths.map((month) => ({ date: month.date, cashValue: month.money, ...cashCoverage(month, cashAccounts) })),
      props.marketData.history,
    );
    return financial.map((point, index) => ({ ...cashMonths[index]!, ...point, trend: point.total }));
  }, [cashAccounts, cashMonths, props.marketData.history]);
  const latestCash = cashMonths.at(-1);
  const position = useMemo(
    () =>
      moneyFinancialPosition({
        asOf: props.marketData.asOf,
        cashValueMinor: Math.round((latestCash?.money ?? 0) * 100),
        cashObservationDate: latestCash?.date,
        ...cashCoverage(latestCash, cashAccounts),
        marketData: props.marketData,
      }),
    [cashAccounts, latestCash, props.marketData],
  );
  return { cashAccounts, months, position };
}

/* ---------- Overview ---------- */

function Overview(props: MoneyTrackerPageData) {
  const [period, setPeriod] = useState<Period>("1y");
  const { cashAccounts, months: allMonths, position } = useFinancialHistory(props);
  const months = period === "all" ? allMonths : allMonths.slice(period === "6m" ? -6 : period === "1y" ? -12 : -60);
  const trends = useMemo(() => moneyTrackerTrendStats(months, allMonths), [allMonths, months]);
  const flow = props.spending.months.filter((month) => month.observed);
  const lastMonth = flow.at(-1);
  const averageSpend = average(flow.slice(-12).map((month) => month.spendMinor));
  const bridge = props.checkIn?.overview?.bridge;
  const stalePrices = props.marketData.positions.filter((item) => item.state !== "fresh").length;
  const latestMonth = props.months.at(-1);
  const oldBalances = latestMonth ? cashAccounts.filter((account) => latestMonth.values[account] !== undefined && !latestMonth.observedAccounts.includes(account)).length : 0;
  const review = [
    [props.reviewCounts.uncategorized, "uncategorized row", "uncategorized rows"],
    [props.reviewCounts.transfers, "transfer to classify", "transfers to classify"],
    [stalePrices, "old price", "old prices"],
    [oldBalances, "old balance", "old balances"],
  ] as const;
  const open = review.filter(([count]) => count > 0);
  const checkInIndex = props.checkIn ? months.findIndex((month) => month.date.slice(0, 7) === props.checkIn!.baseline.slice(0, 7)) : -1;
  const up = trends.positiveMonths;
  return (
    <div className="money-stack">
      <Card className="gap-0 overflow-hidden py-0">
        <div className="money-hero">
          <div className="money-hero__main">
            <p className="text-xs text-muted-foreground">Known net worth</p>
            <p className="money-hero__value">{formatMinor(position.knownNetWorthMinor)}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {bridge ? (
                <>
                  <span className={toneClass(bridge.currentNetWorthMinor - bridge.baselineNetWorthMinor)}>{formatMinor(bridge.currentNetWorthMinor - bridge.baselineNetWorthMinor, { signed: true })}</span> since {formatDay(props.checkIn!.baseline)}
                </>
              ) : (
                "No check-in yet"
              )}
              {trends.yearOverYear?.total.percent !== undefined ? (
                <>
                  {" · "}
                  <span className={toneClass(trends.yearOverYear.total.change)}>{formatRatio(trends.yearOverYear.total.percent / 100, true)}</span> in 1 year
                </>
              ) : null}
            </p>
          </div>
          <StatStrip label="Net worth parts">
            <Stat label="Cash" value={formatMinor(position.cash.valueMinor)} detail={position.cash.carriedAccountCount ? `${position.cash.carriedAccountCount} balance${position.cash.carriedAccountCount === 1 ? "" : "s"} carried` : `${position.cash.observedAccountCount} accounts`} />
            <Stat label="Portfolio" value={formatMinor(position.portfolio.knownValueMinor)} detail={<><span className={toneClass(props.marketData.totals.knownUnrealizedGainMinor)}>{formatMinor(props.marketData.totals.knownUnrealizedGainMinor, { signed: true })}</span> unrealized</>} />
            <Stat
              label={lastMonth ? `Net flow, ${formatMonth(lastMonth.month, true)}` : "Net flow"}
              value={lastMonth ? formatMinor(lastMonth.netCashFlowMinor, { signed: true }) : "—"}
              tone={lastMonth?.netCashFlowMinor}
              detail={lastMonth?.incomeMinor ? `${formatRatio(lastMonth.netCashFlowMinor / lastMonth.incomeMinor)} saved` : "No income recorded"}
            />
            <Stat label={lastMonth ? `Spent, ${formatMonth(lastMonth.month, true)}` : "Spent"} value={lastMonth ? formatMinor(lastMonth.spendMinor) : "—"} detail={averageSpend ? `12-month average ${formatMinor(averageSpend)}` : undefined} />
          </StatStrip>
        </div>
        <div className="money-callout" role="status">
          <span className="money-callout__dot" data-tone={open.length ? undefined : "positive"} aria-hidden="true" />
          <span className="min-w-52 flex-1">
            {open.length ? (
              <>
                <strong className="font-semibold">Review needed.</strong>{" "}
                <span className="text-muted-foreground">
                  {open.map(([count, one, many]) => `${count.toLocaleString("en-GB")} ${count === 1 ? one : many}`).join(", ")}. Totals leave these rows out until you fix them.
                </span>
              </>
            ) : (
              "All data is reviewed. Totals include every row."
            )}
          </span>
          {open.length ? (
            <Link to="/money" search={{ view: "review" }} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Review
            </Link>
          ) : null}
        </div>
      </Card>

      <div className="money-grid money-grid--main">
        <MoneyPanel
          title="Net worth"
          description="End of each month. Hover for cash and portfolio."
          actions={<Segmented label="Net worth range" value={period} onValue={setPeriod} options={[["6m", "6M"], ["1y", "1Y"], ["5y", "5Y"], ["all", "All"]]} />}
        >
          <PanelBody>
            {months.length ? (
              <LineTrendChart
                label={`Net worth from ${formatMonth(months[0]!.date)} to ${formatMonth(months.at(-1)!.date)}. The table view follows.`}
                points={months.map((month) => ({ label: formatMonth(month.date, true), value: month.total }))}
                marker={checkInIndex >= 0 ? { index: checkInIndex, label: "Check-in" } : undefined}
                tooltip={(index) => {
                  const month = months[index]!;
                  const previous = months[index - 1];
                  return {
                    title: formatMonth(month.date),
                    rows: [
                      ["Net worth", formatEuro(month.total), SERIES.primary],
                      ...(previous ? [["Change", formatEuro(month.total - previous.total, { signed: true })] as const] : []),
                      "divider",
                      ["Cash", formatEuro(month.money)],
                      ["Portfolio", formatEuro(month.stocks)],
                    ],
                  };
                }}
              />
            ) : (
              <EmptyState title="No balance history">Import a statement with balances to see net worth over time.</EmptyState>
            )}
          </PanelBody>
          {months.length > 1 ? (
            <PanelFooter>
              <span>
                Change <b className={`font-semibold ${toneClass(trends.periodChange?.change)}`}>{formatEuro(trends.periodChange?.change ?? 0, { signed: true })}</b>
              </span>
              {trends.highWaterMark ? (
                <span>
                  High <b className="font-semibold text-foreground">{formatEuro(trends.highWaterMark.value)}</b> {formatMonth(trends.highWaterMark.date, true)}
                </span>
              ) : null}
              {trends.drawdown && trends.drawdown.change < 0 ? (
                <span>
                  Below high <b className="font-semibold text-negative">{formatRatio((trends.drawdown.percent ?? 0) / 100)}</b>
                </span>
              ) : null}
              <span>
                <b className="font-semibold text-foreground">{up.positive} of {up.total}</b> months up
              </span>
            </PanelFooter>
          ) : null}
          {months.length ? <TableTwin label="View net worth as a table">
            <table className="money-table">
              <thead>
                <tr><th>Month</th><th className="num">Cash</th><th className="num">Portfolio</th><th className="num">Net worth</th></tr>
              </thead>
              <tbody>
                {[...months].reverse().map((month) => (
                  <tr key={month.date}>
                    <td>{formatMonth(month.date)}</td>
                    <td className="num">{formatEuro(month.money)}</td>
                    <td className="num">{formatEuro(month.stocks)}</td>
                    <td className="num">{formatEuro(month.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableTwin> : null}
        </MoneyPanel>
        {props.checkIn?.overview ? (
          <MoneyCheckInBridge checkIn={props.checkIn} overview={props.checkIn.overview} accountLabels={props.accountLabels} />
        ) : (
          <MoneyPanel title="Since check-in">
            <EmptyState title="No check-in yet">A check-in is a day with a statement import. Import a statement to start.</EmptyState>
          </MoneyPanel>
        )}
      </div>

      <div className="money-grid money-grid--two">
        <MoneyPanel
          title="Cash flow"
          description="Last 6 complete months"
          actions={<Link to="/money" search={{ view: "spending" }} className="money-inline-link">Spending</Link>}
        >
          <PanelBody>
            {flow.length ? (
              <Legend>
                <LegendItem color={SERIES.income}>Income</LegendItem>
                <LegendItem color={SERIES.spending}>Spending</LegendItem>
                <LegendItem color={SERIES.net} shape="dot">Net</LegendItem>
              </Legend>
            ) : null}
            {flow.length ? (
              <FlowChart
                height={180}
                label="Income and spending for the last six complete months, with net flow"
                months={flow.slice(-6).map((month) => ({ label: formatMonth(month.month).slice(0, 3), income: (month.incomeMinor + month.refundsMinor) / 100, spending: (month.spendMinor + month.feesMinor + month.taxesMinor) / 100, net: month.netCashFlowMinor / 100 }))}
                tooltip={(index) => flowTooltip(flow.slice(-6)[index]!)}
              />
            ) : (
              <EmptyState title="No cash flow yet">Import a cash statement to see income and spending.</EmptyState>
            )}
          </PanelBody>
        </MoneyPanel>
        <CategoryMonth spending={props.spending} />
      </div>
    </div>
  );
}

/** The last complete month by category, against each category's 12-month average. */
function CategoryMonth({ spending }: { spending: MoneyTrackerPageData["spending"] }) {
  const months = [...new Set(spending.categoryMonths.map((row) => row.month))].sort();
  const last = months.at(-1);
  const window = new Set(months.slice(-12));
  const rows = [...new Set(spending.categoryMonths.map((row) => row.category))]
    .filter((category) => category !== "uncategorized")
    .map((category) => {
      const amount = spending.categoryMonths.find((row) => row.month === last && row.category === category)?.amountMinor ?? 0;
      const total = spending.categoryMonths.filter((row) => row.category === category && window.has(row.month)).reduce((sum, row) => sum + row.amountMinor, 0);
      return { category, amount, average: total / Math.max(window.size, 1) };
    })
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 6);
  const maximum = Math.max(...rows.flatMap((row) => [row.amount, row.average]), 1);
  const uncategorized = spending.categoryMonths.find((row) => row.month === last && row.category === "uncategorized")?.amountMinor ?? 0;
  return (
    <MoneyPanel title={last ? `${formatMonth(last)} by category` : "Spending by category"} description="Bar: that month. Line: 12-month average.">
      <PanelBody>
        {rows.length ? (
          <div className="grid gap-2.5">
            {rows.map((row) => (
              <Link key={row.category} to="/money" search={{ view: "spending", category: row.category }} className="grid grid-cols-[6.5rem_minmax(0,1fr)_5.5rem] items-center gap-3 rounded-sm text-sm hover:text-foreground">
                <span className="truncate">{moneyCategoryLabel(row.category)}</span>
                <BulletBar value={row.amount} marker={row.average} maximum={maximum} />
                <span className="text-right tabular-nums">{formatMinor(row.amount)}</span>
              </Link>
            ))}
            {uncategorized ? <p className="text-xs text-muted-foreground">{formatMinor(uncategorized)} is uncategorized and not in these bars.</p> : null}
          </div>
        ) : (
          <EmptyState title="No categorized spending yet" />
        )}
      </PanelBody>
    </MoneyPanel>
  );
}

/* ---------- Accounts ---------- */

function Accounts(props: MoneyTrackerPageData) {
  const router = useRouter();
  const { months, position } = useFinancialHistory(props);
  const grouped = useMemo(() => props.months.map((month) => groupMonth(month, props.accountRoles)), [props.accountRoles, props.months]);
  const latest = grouped.at(-1);
  const yearAgo = grouped.at(-13);
  const trends = useMemo(() => moneyTrackerTrendStats(months.slice(-12), months), [months]);
  const [editing, setEditing] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const currentMonth = `${new Date().toISOString().slice(0, 7)}-01`;
  const rows = props.accounts.map((account) => {
    const value = latest?.values[account];
    const before = yearAgo?.values[account];
    return {
      account,
      label: props.accountLabels[account] ?? account,
      role: props.accountRoles[account] ?? "cash",
      value,
      change: value !== undefined && before !== undefined ? value - before : undefined,
      history: grouped.slice(-12).flatMap((month) => (month.values[account] === undefined ? [] : [month.values[account]!])),
      lastObserved: props.accountLastObserved[account],
    };
  }).sort((left, right) => (right.value ?? -Infinity) - (left.value ?? -Infinity));
  const current = rows.filter((row) => row.lastObserved === currentMonth).length;
  const withBalance = rows.filter((row) => row.lastObserved).length;
  const saved = async () => {
    setEditing(undefined);
    await router.invalidate();
  };
  return (
    <div className="money-stack">
      <StatStrip label="Account summary">
        <Stat label="Cash" value={formatMinor(position.cash.valueMinor)} detail={`${rows.filter((row) => row.role === "cash").length} accounts`} />
        <Stat label="Portfolio" value={formatMinor(position.portfolio.knownValueMinor)} detail={position.portfolio.priceDate ? `Prices from ${formatDay(position.portfolio.priceDate)}` : "No prices yet"} />
        <Stat label="1-year change" value={trends.yearOverYear ? formatEuro(trends.yearOverYear.total.change, { signed: true }) : "—"} tone={trends.yearOverYear?.total.change} detail="All accounts, end of month" />
        <Stat label={`Updated in ${formatMonth(currentMonth, true)}`} value={`${current} of ${withBalance}`} detail={withBalance - current ? <span className="text-warning">{withBalance - current} balance{withBalance - current === 1 ? " is" : "s are"} older</span> : "All current"} />
      </StatStrip>
      <MoneyPanel
        title="Balances"
        description="Select an account for its activity and history"
        actions={<Button type="button" size="sm" variant="outline" onClick={() => setEditing(editing === "new" ? undefined : "new")}>Add cash account</Button>}
      >
        {editing === "new" ? <BalanceForm accountName onDone={saved} onCancel={() => setEditing(undefined)} /> : null}
        <div className="mt-2 overflow-x-auto">
          <table className="money-table" aria-label="Account balances">
            <thead>
              <tr>
                <th>Account</th>
                <th className="num">Balance</th>
                <th className="num hide-sm">1 year</th>
                <th className="num hide-sm">12 months</th>
                <th className="hide-sm">Updated</th>
                <th className="num"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const old = row.lastObserved !== undefined && row.lastObserved < currentMonth;
                return [
                  <tr key={row.account} data-selectable onClick={() => setSelected(row.account)}>
                    <td>
                      <button type="button" className="text-left font-medium hover:underline" onClick={(event) => { event.stopPropagation(); setSelected(row.account); }}>{row.label}</button>
                      <span className="sub">{row.role === "investment" ? "Investments" : "Cash"}<span className="md:hidden">{row.lastObserved ? ` · ${formatMonth(row.lastObserved, true)}` : ""}</span></span>
                    </td>
                    <td className="num font-semibold">{row.value === undefined ? <span className="text-muted-foreground">No balance</span> : formatEuro(row.value, { precise: true })}</td>
                    <td className={`num hide-sm ${toneClass(row.change)}`}>{row.change === undefined ? "—" : formatEuro(row.change, { signed: true })}</td>
                    <td className="num hide-sm"><SparkLine values={row.history} /></td>
                    <td className="hide-sm">{row.lastObserved ? old ? <Badge variant="outline" className="text-warning">{formatMonth(row.lastObserved, true)}</Badge> : <span className="text-muted-foreground">{formatMonth(row.lastObserved, true)}</span> : <span className="text-muted-foreground">Never</span>}</td>
                    <td className="num" onClick={(event) => event.stopPropagation()}>
                      {row.role === "cash" ? (
                        <Button type="button" size="sm" variant="outline" aria-expanded={editing === row.account} onClick={() => setEditing(editing === row.account ? undefined : row.account)}>
                          Update
                        </Button>
                      ) : null}
                    </td>
                  </tr>,
                  editing === row.account ? (
                    <tr key={`${row.account}:edit`}>
                      <td colSpan={6} className="p-0">
                        <BalanceForm accountId={row.account} label={row.label} value={row.value} onDone={saved} onCancel={() => setEditing(undefined)} />
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
          {rows.length ? null : <EmptyState title="No accounts yet">Import a statement to add its accounts.</EmptyState>}
        </div>
        <TableTwin label={`Monthly snapshots (${grouped.length})`}>
          <SnapshotTable months={grouped} accounts={props.accounts} />
        </TableTwin>
      </MoneyPanel>
      <AccountSheet
        account={selected}
        label={selected ? props.accountLabels[selected] ?? selected : ""}
        months={grouped}
        onClose={() => setSelected(undefined)}
      />
    </div>
  );
}

function SnapshotTable({ months, accounts }: { months: GroupedMonth[]; accounts: string[] }) {
  return (
    <table className="money-table">
      <thead>
        <tr><th>Month</th><th className="num">Cash</th><th className="num">Investments</th><th className="num">Total</th><th className="num">Change</th><th className="num">Source</th></tr>
      </thead>
      <tbody>
        {[...months].reverse().map((month, index, list) => {
          const older = list[index + 1];
          const reused = accounts.filter((account) => month.values[account] !== undefined && !month.observedAccounts.includes(account)).length;
          const change = older && sameCoverage(month, older) ? month.total - older.total : undefined;
          return (
            <tr key={month.date}>
              <td>{formatMonth(month.date)}</td>
              <td className="num">{formatEuro(month.money)}</td>
              <td className="num">{formatEuro(month.stocks)}</td>
              <td className="num">{formatEuro(month.total)}</td>
              <td className={`num ${toneClass(change)}`}>{change === undefined ? "—" : formatEuro(change, { signed: true })}</td>
              <td className="num text-muted-foreground">{reused ? `${reused} carried` : "Updated"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function AccountSheet({ account, label, months, onClose }: { account?: string; label: string; months: GroupedMonth[]; onClose: () => void }) {
  const [activity, setActivity] = useState<MoneyActivityPage["items"]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  useEffect(() => {
    if (!account) return;
    const controller = new AbortController();
    setState("loading");
    const parameters = new URLSearchParams({ query: "", accountId: account, sort: "date", direction: "desc", offset: "0", limit: "30" });
    void fetch(`/api/money/activity?${parameters}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        setActivity(((await response.json()) as MoneyActivityPage).items);
        setState("idle");
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("error");
      });
    return () => controller.abort();
  }, [account]);
  const history = account ? months.filter((month) => month.values[account] !== undefined).map((month) => ({ date: month.date, value: month.values[account]!, observed: month.observedAccounts.includes(account) })) : [];
  return (
    <Sheet open={account !== undefined} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{label}</SheetTitle>
          <SheetDescription>{history.length ? `${formatEuro(history.at(-1)!.value, { precise: true })} in ${formatMonth(history.at(-1)!.date)}` : "No balance recorded"}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          {history.length > 1 ? (
            <LineTrendChart
              height={200}
              label={`${label} balance by month`}
              points={history.slice(-24).map((point) => ({ label: formatMonth(point.date, true), value: point.value }))}
              tooltip={(index) => {
                const point = history.slice(-24)[index]!;
                return { title: formatMonth(point.date), rows: [["Balance", formatEuro(point.value, { precise: true }), SERIES.primary]], hint: point.observed ? undefined : "Carried from an earlier month" };
              }}
            />
          ) : null}
          <section aria-label="Recent activity">
            <h3 className="mb-2 text-sm font-semibold">Recent activity</h3>
            {state === "loading" ? <p className="py-6 text-center text-sm text-muted-foreground">Loading activity…</p> : state === "error" ? <p className="text-sm text-negative" role="alert">Activity could not be loaded.</p> : activity.length ? (
              <div className="divide-y rounded-lg border">
                {activity.map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-4 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.description}</p>
                      <p className="text-xs text-muted-foreground">{formatDay(item.occurredAt)} · {moneyCategoryLabel(item.category)}</p>
                    </div>
                    <span className={`shrink-0 tabular-nums ${item.amountMinor > 0 ? "text-positive" : ""}`}>{formatMinor(item.amountMinor, { precise: true, signed: true })}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No transactions imported for this account.</p>}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ---------- Plan ---------- */

const HORIZONS = [["12", "1Y"], ["36", "3Y"], ["60", "5Y"], ["120", "10Y"]] as const;

function Plan(props: MoneyTrackerPageData) {
  const { months } = useFinancialHistory(props);
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number][0]>("60");
  const [contribution, setContribution] = useState<number>();
  const horizonMonths = Number(horizon);
  const historical = useMemo(() => projectMoneyTrajectory(months, horizonMonths, props.marketData.history), [horizonMonths, months, props.marketData.history]);
  const prediction = useMemo(
    () => (contribution === undefined ? historical : projectMoneyTrajectory(months, horizonMonths, props.marketData.history, contribution)),
    [contribution, historical, horizonMonths, months, props.marketData.history],
  );
  if (!prediction || !historical) {
    return (
      <MoneyPanel>
        <EmptyState title="Not enough history">The plan needs at least six months of complete portfolio history. It appears when enough balances and prices are imported.</EmptyState>
      </MoneyPanel>
    );
  }
  const history = Math.round(historical.monthlyContribution);
  const monthly = contribution ?? history;
  const final = prediction.forecast.at(-1)!;
  const current = months.at(-1)!.total;
  const added = monthly * horizonMonths;
  const years = horizonMonths / 12;
  const observed = prediction.points.filter((point) => point.actual !== undefined).slice(-24);
  const points: FanPoint[] = [
    ...observed.map((point) => ({ label: formatMonth(point.date), observed: point.actual })),
    ...prediction.forecast.map((point) => ({ label: formatMonth(point.date), central: point.estimate, low: point.range[0], high: point.range[1], inflation: point.inflation })),
  ];
  // Start the forecast lines at today's value so they join the observed line.
  const joined = points.map((point, index) => (index === observed.length - 1 ? { ...point, central: current, low: current, high: current, inflation: current } : point));
  const planning = props.planning;
  return (
    <div className="money-stack">
      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-end gap-x-7 gap-y-3 px-4 py-3.5">
          <label className="grid min-w-64 flex-[1_1_18rem] gap-1.5 text-xs text-muted-foreground">
            Monthly contribution
            <span className="flex items-center gap-3">
              <input
                type="range"
                className="w-full accent-[var(--primary)]"
                min={0}
                max={Math.max(5_000, Math.ceil(history / 500) * 1_000)}
                step={50}
                value={monthly}
                aria-label="Monthly contribution slider"
                onChange={(event) => setContribution(event.currentTarget.valueAsNumber)}
              />
              <span className="flex h-8 items-center gap-1 rounded-md border border-input bg-control px-2">
                <input
                  className="w-16 bg-transparent text-right text-sm text-foreground tabular-nums outline-none"
                  inputMode="numeric"
                  aria-label="Monthly contribution in euro"
                  value={monthly}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value.replace(/\D/g, ""));
                    if (Number.isFinite(value)) setContribution(value);
                  }}
                />
                <span className="text-sm">€</span>
              </span>
            </span>
          </label>
          <div className="grid gap-1.5 text-xs text-muted-foreground">
            Horizon
            <Segmented label="Horizon" value={horizon} onValue={setHorizon} options={HORIZONS} />
          </div>
          {contribution !== undefined && contribution !== history ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setContribution(undefined)}>Use history: {formatEuro(history)}</Button>
          ) : (
            <p className="pb-1.5 text-xs text-muted-foreground">{formatEuro(history)} is your average monthly contribution to the portfolio.</p>
          )}
        </div>
        <StatStrip label="Projection summary" className="rounded-none border-t shadow-none">
          <Stat label={`In ${years} year${years === 1 ? "" : "s"}`} value={formatEuro(final.estimate)} detail={`80% range ${formatCompact(final.range[0])} – ${formatCompact(final.range[1])} €`} />
          <Stat label="You add" value={formatEuro(added)} detail={`${horizonMonths} × ${formatEuro(monthly)}`} />
          <Stat label="Growth, central" value={formatEuro(final.estimate - current - added, { signed: true })} tone={final.estimate - current - added} detail={`${formatRatio(prediction.annualGrowthRate)} per year`} />
          <Stat label="Inflation only" value={formatEuro(final.inflation)} detail={`${formatRatio(prediction.annualInflationRate)} per year, same contributions`} />
          {planning.ready ? <Stat label="Median net flow" value={formatMinor(planning.medianMonthlyNetMinor, { signed: true })} tone={planning.medianMonthlyNetMinor} detail={`Per month, last ${planning.observedMonthCount} months`} /> : null}
        </StatStrip>
      </Card>
      <MoneyPanel
        title="Net worth, observed and projected"
        description="The shaded band holds 8 in 10 outcomes of the model"
        actions={
          <Legend>
            <LegendItem color={SERIES.primary} shape="line">Observed</LegendItem>
            <LegendItem color={SERIES.primary} shape="dash">Central estimate</LegendItem>
            <LegendItem color="color-mix(in oklab, var(--money-series-1) 30%, transparent)">80% range</LegendItem>
            <LegendItem color={SERIES.secondary} shape="dash">Inflation only</LegendItem>
          </Legend>
        }
      >
        <PanelBody>
          <FanChart
            label="Observed net worth, then the projected central estimate with its 80% range and an inflation-only line. The table view follows."
            points={joined}
            tooltip={(index) => {
              const point = joined[index]!;
              return point.central === undefined || index === observed.length - 1
                ? { title: point.label, rows: [["Observed", formatEuro(point.observed ?? current), SERIES.primary]] }
                : {
                    title: point.label,
                    rows: [
                      ["High (90%)", formatEuro(point.high!)],
                      ["Central", formatEuro(point.central), SERIES.primary],
                      ["Low (10%)", formatEuro(point.low!)],
                      "divider",
                      ["Inflation only", formatEuro(point.inflation!), SERIES.secondary],
                    ],
                  };
            }}
          />
        </PanelBody>
        <TableTwin label="View the projection as a table">
          <table className="money-table">
            <thead>
              <tr><th>Month</th><th className="num">Low (10%)</th><th className="num">Central</th><th className="num">High (90%)</th><th className="num">Inflation only</th></tr>
            </thead>
            <tbody>
              {prediction.forecast.filter((_, index) => (index + 1) % 12 === 0 || index === prediction.forecast.length - 1).map((point) => (
                <tr key={point.date}>
                  <td>{formatMonth(point.date)}</td>
                  <td className="num">{formatEuro(point.range[0])}</td>
                  <td className="num">{formatEuro(point.estimate)}</td>
                  <td className="num">{formatEuro(point.range[1])}</td>
                  <td className="num">{formatEuro(point.inflation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2.5 text-xs text-muted-foreground">
            The model compounds the portfolio&apos;s return after contributions, from {prediction.historyMonths} months of history, and keeps cash flat.
            The range uses the spread of monthly returns. Deposits, withdrawals, and new market conditions can move the result outside it.
          </p>
        </TableTwin>
      </MoneyPanel>
    </div>
  );
}

/* ---------- Helpers ---------- */

function average(values: readonly number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sameCoverage(left: Month, right: Month) {
  const leftKeys = Object.keys(left.values).sort();
  const rightKeys = Object.keys(right.values).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]);
}

function cashMonth(month: Month, cashAccounts: readonly string[]): GroupedMonth {
  const values = Object.fromEntries(cashAccounts.flatMap((account) => (month.values[account] === undefined ? [] : [[account, month.values[account]]]))) as Record<string, number>;
  const money = Object.values(values).reduce((sum, value) => sum + value, 0);
  return { ...month, values, observedAccounts: month.observedAccounts.filter((account) => cashAccounts.includes(account)), total: money, money, stocks: 0, trend: money };
}

function cashCoverage(month: Month | undefined, cashAccounts: readonly string[]) {
  const tracked = cashAccounts.filter((account) => month?.observedAccounts.includes(account) || (month?.values[account] ?? 0) !== 0);
  return {
    observedCashAccountCount: tracked.filter((account) => month?.observedAccounts.includes(account)).length,
    cashAccountCount: tracked.length,
  };
}

