"use client";

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts";
import type { MoneyTrackerPageData } from "../src/protected-data.js";
import {
  moneyFinancialHistory,
  moneyFinancialPosition,
  moneyTrackerTrendStats,
  type MoneyFinancialPosition,
  type MoneyTrackerAccountCategory,
  type MoneyTrackerTrendStats,
} from "./money-tracker-domain.js";
import { AppShell } from "../src/components/app-shell.js";
import { favicons } from "../src/favicons.js";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "../src/components/ui/alert.js";
import { Badge } from "../src/components/ui/badge.js";
import { Button } from "../src/components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../src/components/ui/card.js";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "../src/components/ui/chart.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../src/components/ui/sheet.js";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../src/components/ui/tabs.js";
import {
  compareMoneyValues,
  MoneySortableHead,
  MoneyTableSearch,
  nextMoneySort,
  type MoneySort,
} from "./money-data-table.js";
import {
  MONEY_ROW_ACTION_CLASS,
  MoneyRowActionCue,
} from "./money-row-action.js";
import type { MoneyCategory } from "./money-enums.js";
import type { MoneyActivityPage } from "./money-repository.js";
import { groupMonth, type GroupedMonth, type Month } from "./money-history.js";
import { MoneyPlanningCard } from "./money-planning-card.js";
import {
  MoneyNav,
  moneyViewTitle,
  type MoneyTrackerView,
} from "./money-tracker-navigation.js";

export type { MoneyTrackerView } from "./money-tracker-navigation.js";
type Period = "6m" | "1y" | "5y" | "all";
type AccountHistoryRange = "1y" | "5y" | "all";
const MoneyCategoryExplorer = lazy(async () => ({
  default: (await import("./money-category-explorer.js")).MoneyCategoryExplorer,
}));
const MoneyActivityView = lazy(async () => ({
  default: (await import("./money-ledger-views.js")).MoneyActivityView,
}));
const MoneyBalanceEntry = lazy(async () => ({
  default: (await import("./money-ledger-views.js")).MoneyBalanceEntry,
}));
const MoneyDataView = lazy(async () => ({
  default: (await import("./money-ledger-views.js")).MoneyDataView,
}));
const MoneyInvestmentsView = lazy(async () => ({
  default: (await import("./money-ledger-views.js")).MoneyInvestmentsView,
}));
const MoneySpendingView = lazy(async () => ({
  default: (await import("./money-ledger-views.js")).MoneySpendingView,
}));

const currency = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const preciseCurrency = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});
const colors = [
  "#67e8f9",
  "#c084fc",
  "#facc15",
  "#4ade80",
  "#60a5fa",
  "#fb7185",
  "#f472b6",
];
// Colors are passed directly to Recharts. ChartConfig colors generate an inline
// style element, which the platform's nonce-only CSP intentionally blocks.
const totalConfig = {
  money: { label: "Cash" },
  stocks: { label: "Portfolio value" },
  total: { label: "Known net worth" },
  trend: { label: "Linear trend" },
} satisfies ChartConfig;
const changeConfig = {
  change: { label: "Balance change" },
} satisfies ChartConfig;
const accountBalanceConfig = {
  value: { label: "Balance" },
} satisfies ChartConfig;
const predictionConfig = {
  actual: { label: "Observed total" },
  estimate: { label: "Central estimate" },
  range: { label: "80% range" },
} satisfies ChartConfig;

export function MoneyTrackerPage(
  props: MoneyTrackerPageData & {
    view: MoneyTrackerView;
    category?: MoneyCategory;
    review?: boolean;
  },
) {
  const [period, setPeriod] = useState<Period>("1y");
  const cashAccounts = useMemo(
    () =>
      props.accounts.filter(
        (account) => roleCategory(props.accountRoles, account) === "money",
      ),
    [props.accountRoles, props.accounts],
  );
  const balanceAccounts = useMemo(
    () =>
      props.accounts.filter(
        (account) => props.accountLastObserved[account] !== undefined,
      ),
    [props.accountLastObserved, props.accounts],
  );
  const allCashMonths = useMemo(
    () => props.months.map((month) => cashMonth(month, cashAccounts)),
    [cashAccounts, props.months],
  );
  const allMonths = useMemo(() => {
    const financial = moneyFinancialHistory(
      allCashMonths.map((month) => ({
        date: month.date,
        cashValue: month.money,
        ...cashCoverage(month, cashAccounts),
      })),
      props.marketData.history,
    );
    return financial.map((point, index) => ({
      ...allCashMonths[index]!,
      ...point,
      trend: point.total,
    }));
  }, [allCashMonths, cashAccounts.length, props.marketData.history]);
  const months = useMemo(
    () =>
      withLinearTrend(
        period === "all"
          ? allMonths
          : allMonths.slice(period === "6m" ? -6 : period === "1y" ? -12 : -60),
      ),
    [allMonths, period],
  );
  const allAccountMonths = useMemo(
    () => props.months.map((month) => groupMonth(month, props.accountRoles)),
    [props.accountRoles, props.months],
  );
  const visibleAccountMonths = useMemo(
    () =>
      period === "all"
        ? allAccountMonths
        : allAccountMonths.slice(period === "6m" ? -6 : period === "1y" ? -12 : -60),
    [allAccountMonths, period],
  );
  const latest = months.at(-1);
  const previous = months.at(-2);
  const latestCash = allCashMonths.at(-1);
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
  const latestObservedChange = withChanges(months).at(-1);
  const monthlyChange =
    latestObservedChange && latestObservedChange.date === latest?.date
      ? latestObservedChange.change
      : undefined;
  const trends = useMemo(
    () => moneyTrackerTrendStats(months, allMonths),
    [allMonths, months],
  );
  const showPeriod = props.view === "accounts" || props.view === "insights";

  return (
    <>
      <AppShell product="Money" accent="lime" icon={favicons.money} showSignOut />
      <main id="main" className="app-page money-page">
        <header className="app-heading mb-0">
          <div>
            <p className="eyebrow">Money</p>
            <h1>{moneyViewTitle(props.view)}</h1>
            <p>{viewDescription(props.view)}</p>
          </div>
          {showPeriod ? (
            <div className="app-heading__actions">
              <PeriodSelector period={period} onPeriod={setPeriod} />
            </div>
          ) : null}
        </header>
        <div className="money-layout">
          <MoneyNav />
          <div className="money-content space-y-4">
            <Suspense fallback={<MoneyViewFallback />}>
            {props.view === "overview" ? (
              <Overview
                {...props}
                position={position}
                months={months}
                latest={latest}
                trends={trends}
                period={period}
                onPeriod={setPeriod}
              />
            ) : null}
            {props.view === "transactions" ? (
              <MoneyActivityView
                activity={props.activity}
                accounts={props.accounts}
                accountLabels={props.accountLabels}
                transactionCount={props.transactionCount}
                revertedCount={props.revertedCount}
                spending={props.spending}
                transferReview={props.transferReview}
                transferReviewGroups={props.transferReviewGroups}
                initialCategory={props.category}
                initialReviewOnly={props.review}
              />
            ) : null}
            {props.view === "cash-flow" ? (
              <MoneySpendingView
                spending={props.spending}
                transferReview={props.transferReview}
              />
            ) : null}
            {props.view === "categories" ? (
              <MoneyCategoryExplorer
                spending={props.spending}
                initialCategory={props.category}
              />
            ) : null}
            {props.view === "investments" ? (
              <MoneyInvestmentsView
                investments={props.investments}
                marketData={props.marketData}
              />
            ) : null}
            {props.view === "accounts" ? (
              <>
                <Accounts
                  accounts={props.accounts}
                  accountLabels={props.accountLabels}
                  accountRoles={props.accountRoles}
                  accountLastObserved={props.accountLastObserved}
                  marketData={props.marketData}
                  months={visibleAccountMonths}
                  historyMonths={allAccountMonths}
                  latest={visibleAccountMonths.at(-1)}
                  previous={visibleAccountMonths.at(-2)}
                />
                <History
                  accounts={balanceAccounts}
                  accountLabels={props.accountLabels}
                  months={visibleAccountMonths}
                />
                <MoneyBalanceEntry
                  accounts={cashAccounts}
                  accountLabels={props.accountLabels}
                />
              </>
            ) : null}
            {props.view === "insights" ? (
              <Insights
                {...props}
                accounts={cashAccounts}
                position={position}
                months={months}
                latest={latest}
                previous={previous}
                monthlyChange={monthlyChange}
                trends={trends}
              />
            ) : null}
            {props.view === "predictions" ? (
              <Predictions months={allMonths} />
            ) : null}
            {props.view === "data" ? <MoneyDataView {...props} /> : null}
            </Suspense>
          </div>
        </div>
      </main>
    </>
  );
}

function MoneyViewFallback() {
  return (
    <Card aria-busy="true">
      <CardContent className="p-6 text-sm text-muted-foreground">
        Loading view…
      </CardContent>
    </Card>
  );
}

function Overview({
  accounts,
  marketData,
  revertedCount,
  spending,
  transferReview,
  position,
  months,
  latest,
  trends,
  period,
  onPeriod,
}: MoneyTrackerPageData & {
  position: MoneyFinancialPosition;
  months: GroupedMonth[];
  latest?: GroupedMonth;
  trends: MoneyTrackerTrendStats;
  period: Period;
  onPeriod: (period: Period) => void;
}) {
  const observedCashFlow = spending.months.filter((month) => month.observed);
  const recentCashFlow = observedCashFlow.slice(-6);
  const maximumCashFlow = Math.max(
    ...recentCashFlow.flatMap((month) => [month.spendMinor, month.incomeMinor]),
    1,
  );
  const lastCashFlow = observedCashFlow.at(-1);
  const savingsRate = lastCashFlow?.incomeMinor
    ? (lastCashFlow.netCashFlowMinor / lastCashFlow.incomeMinor) * 100
    : undefined;
  const unresolvedTransfers =
    transferReview.unresolvedPositiveCount +
    transferReview.unresolvedNegativeCount;
  const observedAccounts = position.cash.observedAccountCount;
  const carriedAccounts = position.cash.carriedAccountCount;
  const unpricedPositions = marketData.positions.filter(
    (position) => position.state === "unpriced",
  ).length;
  const stalePositions = marketData.positions.filter(
    (position) => position.state === "stale",
  ).length;
  const attentionCount =
    Number(spending.uncategorizedCount > 0) +
    Number(unresolvedTransfers > 0) +
    Number(unpricedPositions + stalePositions > 0) +
    Number(carriedAccounts > 0);
  return (
    <>
      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Money summary"
      >
        <Metric
          label="Known net worth"
          value={formatMinor(position.knownNetWorthMinor, "EUR")}
          detail={`${formatSigned(trends.periodChange?.change)} selected range · ${carriedAccounts ? `${carriedAccounts} carried` : "cash observed"} · ${unpricedPositions ? `${unpricedPositions} unpriced` : stalePositions ? `${stalePositions} stale` : "prices current"}`}
          tone={tone(trends.periodChange?.change)}
        />
        <Metric
          label={
            unresolvedTransfers
              ? "Last classified-flow month"
              : "Last cash-flow month"
          }
          value={
            lastCashFlow
              ? formatMinor(lastCashFlow.netCashFlowMinor, "EUR")
              : "No data"
          }
          detail={
            unresolvedTransfers
              ? `${lastCashFlow?.month ?? "No month"} · ${unresolvedTransfers.toLocaleString("en-GB")} transfers excluded`
              : savingsRate === undefined
                ? lastCashFlow?.month
                : `${lastCashFlow?.month} · ${savingsRate.toFixed(1)}% savings rate`
          }
          tone={tone(lastCashFlow?.netCashFlowMinor)}
        />
        <Metric
          label="Tracked cash"
          value={formatMinor(position.cash.valueMinor, "EUR")}
          detail={`${observedAccounts} observed, ${carriedAccounts} carried · ${position.cash.observationDate ?? "no snapshot"}`}
        />
        <Metric
          label="Portfolio value"
          value={formatMinor(position.portfolio.knownValueMinor, "EUR")}
          detail={`${formatMinor(marketData.totals.knownUnrealizedGainMinor, "EUR")} unrealized${unpricedPositions ? ` · ${unpricedPositions} unpriced` : stalePositions ? ` · ${stalePositions} stale` : ""}`}
          tone={tone(marketData.totals.knownUnrealizedGainMinor)}
        />
      </section>
      <section className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,.7fr)]">
        <BalanceChart months={months} period={period} onPeriod={onPeriod} />
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Needs attention</CardTitle>
                <CardDescription>
                  Items that affect confidence in the totals
                </CardDescription>
              </div>
              <Badge variant={attentionCount ? "destructive" : "outline"}>
                {attentionCount} issue types
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="divide-y p-0">
            <AttentionRow
              label="Carried balances"
              value={carriedAccounts.toLocaleString("en-GB")}
              detail="Check when each account was last observed"
              ready={carriedAccounts === 0}
              view="accounts"
              action="Open accounts"
            />
            <AttentionRow
              label="Uncategorized spending"
              value={spending.uncategorizedCount.toLocaleString("en-GB")}
              detail="Complete categories for trustworthy spending"
              ready={spending.uncategorizedCount === 0}
              view="transactions"
              action="Review transactions"
              search={{ category: "uncategorized" }}
            />
            <AttentionRow
              label="Unresolved transfer rows"
              value={unresolvedTransfers.toLocaleString("en-GB")}
              detail="Classify exact transaction groups before trusting cash flow"
              ready={unresolvedTransfers === 0}
              view="transactions"
              action="Review transfers"
              search={{ review: true }}
            />
            <AttentionRow
              label="Portfolio valuation"
              value={
                marketData.positions.length
                  ? unpricedPositions
                    ? `${unpricedPositions} unpriced`
                    : stalePositions
                      ? `${stalePositions} stale`
                      : "Current"
                  : "No positions"
              }
              detail={
                marketData.positions.length
                  ? `${marketData.positions.length - stalePositions - unpricedPositions} of ${marketData.positions.length} fresh`
                  : "Import investment activity to begin"
              }
              ready={unpricedPositions + stalePositions === 0}
              view="investments"
              action="Open investments"
            />
            <p className="px-4 py-3 text-xs text-muted-foreground">
              {revertedCount.toLocaleString("en-GB")} reverted source rows are
              excluded from analytics.
            </p>
          </CardContent>
        </Card>
      </section>
      <section className="grid items-start gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>
              {unresolvedTransfers
                ? "Recent classified flow"
                : "Recent cash flow"}
            </CardTitle>
            <CardDescription>
              Income + refunds − spending − fees − taxes. Linked internal and
              unresolved transfers are excluded.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-5">
            {recentCashFlow.length ? (
              recentCashFlow.map((month) => {
                const otherCashFlow =
                  month.refundsMinor - month.feesMinor - month.taxesMinor;
                return (
                  <div
                    className="grid grid-cols-1 items-center gap-2 text-xs sm:grid-cols-[4.5rem_minmax(5rem,1fr)_minmax(5rem,1fr)_8rem_6rem] sm:gap-3"
                    key={month.month}
                  >
                    <span className="text-muted-foreground">{month.month}</span>
                    <CashFlowBar
                      label="Income"
                      value={month.incomeMinor}
                      maximum={maximumCashFlow}
                      tone="income"
                    />
                    <CashFlowBar
                      label="Spent"
                      value={month.spendMinor}
                      maximum={maximumCashFlow}
                      tone="spend"
                    />
                    <div className="text-right">
                      <span className="block text-muted-foreground">
                        Refunds − costs
                      </span>
                      <strong className="font-mono font-medium">{`${otherCashFlow >= 0 ? "+" : ""}${formatMinor(otherCashFlow, "EUR")}`}</strong>
                    </div>
                    <div className="text-right">
                      <span className="block text-muted-foreground">
                        {unresolvedTransfers ? "Classified net" : "Net"}
                      </span>
                      <strong
                        className={`font-mono ${changeClass(month.netCashFlowMinor)}`}
                      >
                        {formatMinor(month.netCashFlowMinor, "EUR")}
                      </strong>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">
                Import a cash statement to see monthly cash flow.
              </p>
            )}
          </CardContent>
        </Card>
        <CashFlowReconciliation
          month={lastCashFlow}
          unresolvedTransfers={unresolvedTransfers}
        />
      </section>
    </>
  );
}

function CashFlowReconciliation({
  month,
  unresolvedTransfers,
}: {
  month?: MoneyTrackerPageData["spending"]["months"][number];
  unresolvedTransfers: number;
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>
          {unresolvedTransfers
            ? "Classified-flow reconciliation"
            : "Cash-flow reconciliation"}
        </CardTitle>
        <CardDescription>
          {month
            ? `${month.month} · ${unresolvedTransfers ? `${unresolvedTransfers.toLocaleString("en-GB")} transfer rows excluded` : "every cash-flow component"}`
            : "No observed cash-flow month"}
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y p-0">
        {month ? (
          <>
            <StatRow
              label="Income"
              value={formatMinor(month.incomeMinor, "EUR")}
            />
            <StatRow
              label="Refunds"
              value={formatMinor(month.refundsMinor, "EUR")}
            />
            <StatRow
              label="Spending"
              value={`−${formatMinor(month.spendMinor, "EUR")}`}
            />
            <StatRow
              label="Fees"
              value={`−${formatMinor(month.feesMinor, "EUR")}`}
            />
            <StatRow
              label="Taxes"
              value={`−${formatMinor(month.taxesMinor, "EUR")}`}
            />
            <StatRow
              label={unresolvedTransfers ? "Classified net" : "Net cash flow"}
              value={formatMinor(month.netCashFlowMinor, "EUR")}
              detail="income + refunds − spending − fees − taxes"
            />
          </>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            Import cash activity to see the reconciliation.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Insights({
  accounts,
  accountLabels,
  accountRoles: providedAccountRoles,
  planning,
  position,
  months,
  latest,
  previous,
  monthlyChange,
  trends,
}: MoneyTrackerPageData & {
  position: MoneyFinancialPosition;
  months: GroupedMonth[];
  latest?: GroupedMonth;
  previous?: GroupedMonth;
  monthlyChange?: number;
  trends: MoneyTrackerTrendStats;
}) {
  const accountRoles = {
    ...providedAccountRoles,
    __portfolio: "investment" as const,
  };
  const changes = withChanges(months);
  const portfolioContributor =
    position.portfolio.openPositionCount || latest?.stocks
      ? [
          {
            account: "__portfolio",
            label: "Portfolio",
            value: latest?.stocks,
            previous: previous?.stocks,
            change:
              latest && previous ? latest.stocks - previous.stocks : undefined,
          },
        ]
      : [];
  const contributors = [
    ...accountRows(accounts, accountLabels, latest, previous),
    ...portfolioContributor,
  ]
    .filter((item) => item.change !== undefined)
    .sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0));
  const maxChange = Math.max(
    ...contributors.map((item) => Math.abs(item.change ?? 0)),
    1,
  );
  const composition = [
    ...accountRows(accounts, accountLabels, latest),
    ...portfolioContributor,
  ]
    .filter((item) => item.value !== undefined)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const topTwoShare = latest?.total
    ? (composition
        .slice(0, 2)
        .reduce((sum, item) => sum + (item.value ?? 0), 0) /
        latest.total) *
      100
    : undefined;
  return (
    <>
      <section
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
        aria-label="Balance summary"
      >
        <Metric
          label="Known net worth"
          value={formatMinor(position.knownNetWorthMinor, "EUR")}
          detail={formatTrendPercent(trends.yearOverYear?.total.percent)}
          tone={tone(trends.yearOverYear?.total.change)}
        />
        <Metric
          label="Tracked cash"
          value={formatMinor(position.cash.valueMinor, "EUR")}
          detail={
            trends.yearOverYear
              ? `${formatSigned(trends.yearOverYear.money.change)} YoY`
              : position.cash.observationDate
          }
          tone={tone(trends.yearOverYear?.money.change)}
        />
        <Metric
          label="Portfolio value"
          value={formatMinor(position.portfolio.knownValueMinor, "EUR")}
          detail={`${position.portfolio.pricedPositionCount} / ${position.portfolio.openPositionCount} priced`}
        />
        {trends.drawdown ? (
          <Metric
            label="Balance drawdown"
            value={formatTrendPercent(trends.drawdown.percent)}
            detail={formatSigned(trends.drawdown.change)}
            tone={tone(trends.drawdown.change)}
          />
        ) : null}
        {trends.momentum ? (
          <Metric
            label="3m average balance shift"
            value={formatTrendPercent(trends.momentum.percent)}
            detail={formatSigned(trends.momentum.change)}
            tone={tone(trends.momentum.change)}
          />
        ) : null}
        <Metric
          label="Positive months"
          value={`${trends.positiveMonths.positive} / ${trends.positiveMonths.total}`}
          detail={formatTrendPercent(trends.positiveMonths.rate)}
        />
      </section>
      <MoneyPlanningCard planning={planning} />
      <section className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.75fr)_minmax(18rem,.75fr)]">
        <ChartCard
          title="Tracked total and trend"
          description="Actual monthly total with a separate linear trend"
        >
          <MountedChart
            fallback={
              <ChartFallback values={months.map((month) => month.total)} />
            }
          >
            <ChartContainer
              config={totalConfig}
              className="h-[23rem] w-full aspect-auto"
              initialDimension={{ width: 760, height: 368 }}
              role="img"
              aria-label="Tracked total, cash and reported investment balances with linear trend. Exact values follow in an expandable table."
            >
              <ComposedChart
                accessibilityLayer={false}
                data={months}
                margin={{ left: 4, right: 12, top: 8 }}
              >
                <defs>
                  <linearGradient
                    id="money-balance-fill"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor={colors[0]}
                      stopOpacity={0.34}
                    />
                    <stop
                      offset="95%"
                      stopColor={colors[0]}
                      stopOpacity={0.04}
                    />
                  </linearGradient>
                  <linearGradient
                    id="stock-balance-fill"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor={colors[1]}
                      stopOpacity={0.34}
                    />
                    <stop
                      offset="95%"
                      stopColor={colors[1]}
                      stopOpacity={0.04}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  minTickGap={28}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={72}
                  tickFormatter={(value: number) => currency.format(value)}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  dataKey="money"
                  name="Cash"
                  type="monotone"
                  stackId="tracked"
                  fill="url(#money-balance-fill)"
                  stroke={colors[0]}
                  strokeWidth={1.5}
                />
                <Area
                  dataKey="stocks"
                  name="Investment balances"
                  type="monotone"
                  stackId="tracked"
                  fill="url(#stock-balance-fill)"
                  stroke={colors[1]}
                  strokeWidth={1.5}
                />
                <Line
                  dataKey="total"
                  name="Tracked total"
                  type="monotone"
                  stroke="#fafafa"
                  strokeWidth={2.5}
                  dot={false}
                />
                <Line
                  dataKey="trend"
                  name="Linear trend"
                  type="linear"
                  stroke="#facc15"
                  strokeWidth={1.5}
                  strokeDasharray="7 6"
                  dot={false}
                />
              </ComposedChart>
            </ChartContainer>
          </MountedChart>
          <BalanceDataDisclosure months={months} includeTrend />
        </ChartCard>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Composition and concentration</CardTitle>
            <CardDescription>
              {latest?.date ?? "No snapshot available"}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="space-y-2 border-b px-4 py-4">
              <div className="flex justify-between text-xs">
                <span className="text-cyan-300">
                  Cash{" "}
                  {latest?.total
                    ? `${((latest.money / latest.total) * 100).toFixed(1)}%`
                    : "—"}
                </span>
                <span className="text-purple-300">
                  Stocks{" "}
                  {latest?.total
                    ? `${((latest.stocks / latest.total) * 100).toFixed(1)}%`
                    : "—"}
                </span>
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="bg-cyan-300"
                  style={{
                    width: `${latest?.total ? (latest.money / latest.total) * 100 : 0}%`,
                  }}
                />
                <div
                  className="bg-purple-400"
                  style={{
                    width: `${latest?.total ? (latest.stocks / latest.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <div className="divide-y">
                {composition.slice(0, 4).map((item) => (
                  <div
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-2.5 text-sm"
                    key={item.account}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {roleCategory(accountRoles, item.account) === "stocks"
                          ? "Stocks"
                          : "Cash"}
                      </p>
                    </div>
                    <div className="text-right font-mono">
                      <p>{preciseCurrency.format(item.value ?? 0)}</p>
                      <p className="text-xs text-muted-foreground">
                        {latest?.total
                          ? `${(((item.value ?? 0) / latest.total) * 100).toFixed(1)}%`
                          : "—"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-4 py-3 text-xs text-muted-foreground">
              {topTwoShare === undefined
                ? "No concentration data."
                : `The two largest accounts hold ${topTwoShare.toFixed(1)}% of the current total.`}
            </div>
          </CardContent>
        </Card>
      </section>
      <section className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title="Monthly balance change"
          description="Absolute month-over-month movement"
        >
          <MountedChart
            fallback={
              <ChartFallback values={changes.map((month) => month.change)} />
            }
          >
            <ChartContainer
              config={changeConfig}
              className="h-64 w-full aspect-auto"
              role="img"
              aria-label="Month-over-month tracked balance changes. Exact values follow in an expandable table."
            >
              <BarChart accessibilityLayer={false} data={changes}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={68}
                  tickFormatter={(value: number) => currency.format(value)}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => (
                        <TooltipValue
                          label="Change"
                          value={formatSigned(Number(value))}
                        />
                      )}
                    />
                  }
                />
                <Bar dataKey="change" radius={3}>
                  {changes.map((month) => (
                    <Cell
                      key={month.date}
                      fill={month.change < 0 ? "#fb7185" : "#4ade80"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </MountedChart>
          <ChangeDataDisclosure changes={changes} />
        </ChartCard>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>What moved this month</CardTitle>
            <CardDescription>
              {formatSigned(monthlyChange)} across the latest snapshot
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {(["stocks", "money"] as const).map((category) => {
              const items = contributors.filter(
                (item) => roleCategory(accountRoles, item.account) === category,
              );
              const subtotal = items.reduce(
                (sum, item) => sum + (item.change ?? 0),
                0,
              );
              return (
                <section key={category} className="border-b last:border-b-0">
                  <div className="flex items-center justify-between bg-muted/40 px-4 py-2.5">
                    <span className="text-[.68rem] font-semibold uppercase tracking-[.08em] text-muted-foreground">
                      {category === "stocks" ? "Stocks" : "Cash"}
                    </span>
                    <span
                      className={`font-mono text-xs ${changeClass(subtotal)}`}
                    >
                      {formatSigned(subtotal, true)}
                    </span>
                  </div>
                  <div className="divide-y">
                    {items.map((item) => (
                      <div
                        className="grid grid-cols-[minmax(7rem,1fr)_minmax(6rem,1.4fr)_auto] items-center gap-3 px-4 py-3 text-sm"
                        key={item.account}
                      >
                        <span className="truncate font-medium">
                          {item.label}
                        </span>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full ${item.change !== undefined && item.change < 0 ? "bg-rose-400" : "bg-emerald-400"}`}
                            style={{
                              width: `${(Math.abs(item.change ?? 0) / maxChange) * 100}%`,
                            }}
                          />
                        </div>
                        <span className={changeClass(item.change)}>
                          {formatSigned(item.change, true)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </CardContent>
        </Card>
      </section>
      <Alert role="note">
        <AlertTitle>How to read these trends</AlertTitle>
        <AlertDescription>
          Momentum compares the latest three-month average with the previous
          three months. Drawdown compares the current balance with the
          selected-range high. Tracked totals can include carried balances;
          changes include deposits, withdrawals, and market movement, so they
          are not investment returns.
        </AlertDescription>
      </Alert>
      <section
        className="grid items-start gap-3 lg:grid-cols-3"
        aria-label="Trend statistics"
      >
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Year-over-year</CardTitle>
            <CardDescription>
              {trends.yearOverYear
                ? `Compared with ${trends.yearOverYear.comparisonDate}`
                : "A matching prior-year month is required"}
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y p-0">
            <TrendRow label="Total" change={trends.yearOverYear?.total} />
            <TrendRow label="Cash" change={trends.yearOverYear?.money} />
            <TrendRow label="Stocks" change={trends.yearOverYear?.stocks} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Selected-range trend</CardTitle>
            <CardDescription>
              Calculated from the visible snapshots
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y p-0">
            <TrendRow label="Cumulative change" change={trends.periodChange} />
            <StatRow
              label="Geometric monthly change"
              value={formatTrendPercent(trends.geometricAverageMonthlyPercent)}
            />
            <StatRow
              label="Average total change"
              value={formatSigned(trends.averageMonthlyChange, true)}
            />
            <StatRow
              label="Average cash change"
              value={formatSigned(trends.averageMoneyChange, true)}
            />
            <StatRow
              label="Average stock change"
              value={formatSigned(trends.averageStocksChange, true)}
            />
            <StatRow
              label="High-water mark"
              value={
                trends.highWaterMark
                  ? preciseCurrency.format(trends.highWaterMark.value)
                  : "—"
              }
              detail={trends.highWaterMark?.date}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Annual change and allocation</CardTitle>
            <CardDescription>
              Each year starts from the prior year-end when available
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {trends.yearlyChanges.map((item) => (
              <TrendRow
                key={item.year}
                label={String(item.year)}
                change={item}
              />
            ))}
            {trends.allocation?.previousYear ? (
              <AllocationRow
                label={trends.allocation.previousYear.date}
                money={trends.allocation.previousYear.money}
                stocks={trends.allocation.previousYear.stocks}
              />
            ) : null}
            {trends.allocation ? (
              <AllocationRow
                label="Current"
                money={trends.allocation.current.money}
                stocks={trends.allocation.current.stocks}
              />
            ) : null}
            <div className="px-4 py-3 text-xs text-muted-foreground">
              Balance movement includes transfers, deposits, withdrawals, and
              market changes. It is not an investment-return calculation.
            </div>
          </CardContent>
        </Card>
      </section>
    </>
  );
}

type PredictionHorizon = 6 | 12 | 24;
type PredictionPoint = Readonly<{
  date: string;
  actual?: number;
  estimate?: number;
  range?: readonly [number, number];
}>;
export type MoneyTrajectoryPrediction = Readonly<{
  historyMonths: number;
  horizonMonths: PredictionHorizon;
  monthlySlope: number;
  residualVariation: number;
  fit: number;
  points: readonly PredictionPoint[];
  forecast: readonly Required<
    Pick<PredictionPoint, "date" | "estimate" | "range">
  >[];
}>;

/** Produces an auditable trend projection from at most the latest 36 monthly totals. */
export function projectMoneyTrajectory(
  months: readonly Pick<GroupedMonth, "date" | "total">[],
  horizonMonths: PredictionHorizon,
): MoneyTrajectoryPrediction | undefined {
  const history = months
    .filter((month) => Number.isFinite(month.total))
    .slice(-36);
  if (history.length < 6) return undefined;

  const meanX = (history.length - 1) / 2;
  const meanY =
    history.reduce((sum, month) => sum + month.total, 0) / history.length;
  const sumSquaresX = history.reduce(
    (sum, _month, index) => sum + (index - meanX) ** 2,
    0,
  );
  const monthlySlope =
    history.reduce(
      (sum, month, index) =>
        sum + (index - meanX) * (month.total - meanY),
      0,
    ) / sumSquaresX;
  const intercept = meanY - monthlySlope * meanX;
  const squaredResiduals = history.reduce((sum, month, index) => {
    const residual = month.total - (intercept + monthlySlope * index);
    return sum + residual ** 2;
  }, 0);
  const totalVariation = history.reduce(
    (sum, month) => sum + (month.total - meanY) ** 2,
    0,
  );
  const residualVariation = Math.sqrt(
    squaredResiduals / Math.max(history.length - 2, 1),
  );
  const fit =
    totalVariation === 0
      ? 1
      : Math.max(0, Math.min(1, 1 - squaredResiduals / totalVariation));
  const latest = history.at(-1)!;
  const forecast = Array.from({ length: horizonMonths }, (_, index) => {
    const monthsAhead = index + 1;
    const futureX = history.length - 1 + monthsAhead;
    const estimate = latest.total + monthlySlope * monthsAhead;
    const predictionError =
      residualVariation *
      Math.sqrt(
        1 +
          1 / history.length +
          (futureX - meanX) ** 2 / sumSquaresX,
      );
    const margin = 1.281551565545 * predictionError;
    return {
      date: addCalendarMonths(latest.date, monthsAhead),
      estimate,
      range: [estimate - margin, estimate + margin] as const,
    };
  });

  return {
    historyMonths: history.length,
    horizonMonths,
    monthlySlope,
    residualVariation,
    fit,
    points: [
      ...history.map((month, index) => ({
        date: month.date,
        actual: month.total,
        ...(index === history.length - 1
          ? {
              estimate: latest.total,
              range: [latest.total, latest.total] as const,
            }
          : {}),
      })),
      ...forecast,
    ],
    forecast,
  };
}

function Predictions({ months }: { months: GroupedMonth[] }) {
  const [horizon, setHorizon] = useState<PredictionHorizon>(12);
  const prediction = useMemo(
    () => projectMoneyTrajectory(months, horizon),
    [horizon, months],
  );
  if (!prediction) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not enough history</CardTitle>
          <CardDescription>
            Predictions need at least six monthly balance snapshots.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Add more balance history and this view will calculate automatically.
        </CardContent>
      </Card>
    );
  }

  const finalPoint = prediction.forecast.at(-1)!;
  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Projection horizon</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Recalculate the same model over a different future range.
          </p>
        </div>
        <div role="group" aria-label="Prediction horizon" className="flex gap-1">
          {([6, 12, 24] as const).map((value) => (
            <PeriodButton
              key={value}
              active={horizon === value}
              onClick={() => setHorizon(value)}
            >
              {value}M
            </PeriodButton>
          ))}
        </div>
      </section>
      <section
        className="grid gap-3 sm:grid-cols-3"
        aria-label="Prediction summary"
      >
        <Metric
          label={`Central estimate in ${horizon} months`}
          value={currency.format(finalPoint.estimate)}
          detail={`${formatSigned(prediction.monthlySlope)} modeled each month`}
          tone={tone(prediction.monthlySlope)}
        />
        <Metric
          label="80% model range"
          value={`${currency.format(finalPoint.range[0])} to ${currency.format(finalPoint.range[1])}`}
          detail={`At ${finalPoint.date}`}
        />
        <Metric
          label="History used"
          value={`${prediction.historyMonths} months`}
          detail={`Trend fit ${(prediction.fit * 100).toFixed(0)}%`}
        />
      </section>
      <section className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.75fr)_minmax(18rem,.75fr)]">
        <ChartCard
          title="Net-worth trajectory"
          description="Observed monthly totals followed by a central estimate and widening 80% range"
        >
          <MountedChart
            fallback={
              <ChartFallback
                values={prediction.points.flatMap((point) =>
                  point.actual === undefined ? [] : [point.actual],
                )}
              />
            }
          >
            <ChartContainer
              config={predictionConfig}
              className="h-[25rem] w-full aspect-auto"
              initialDimension={{ width: 760, height: 400 }}
              role="img"
              aria-label="Observed net worth and projected central estimate with an 80 percent range. Exact projected values follow in an expandable table."
            >
              <ComposedChart
                accessibilityLayer={false}
                data={prediction.points}
                margin={{ left: 4, right: 12, top: 8 }}
              >
                <defs>
                  <linearGradient
                    id="money-prediction-range"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#a3e635" stopOpacity={0.34} />
                    <stop offset="95%" stopColor="#a3e635" stopOpacity={0.08} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  minTickGap={28}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={72}
                  tickFormatter={(value: number) => currency.format(value)}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => {
                        const label = String(name);
                        if (Array.isArray(value)) {
                          return (
                            <TooltipValue
                              label={label}
                              value={`${currency.format(Number(value[0]))} to ${currency.format(Number(value[1]))}`}
                            />
                          );
                        }
                        return (
                          <TooltipValue
                            label={label}
                            value={currency.format(Number(value))}
                          />
                        );
                      }}
                    />
                  }
                />
                <Area
                  dataKey="range"
                  name="80% range"
                  type="monotone"
                  fill="url(#money-prediction-range)"
                  stroke="#84cc16"
                  strokeWidth={1}
                  connectNulls
                />
                <Line
                  dataKey="actual"
                  name="Observed total"
                  type="monotone"
                  stroke="#fafafa"
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls
                />
                <Line
                  dataKey="estimate"
                  name="Central estimate"
                  type="linear"
                  stroke="#a3e635"
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls
                />
              </ComposedChart>
            </ChartContainer>
          </MountedChart>
          <PredictionDataDisclosure points={prediction.forecast} />
        </ChartCard>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Model drivers</CardTitle>
            <CardDescription>Inputs behind the displayed range</CardDescription>
          </CardHeader>
          <CardContent className="divide-y p-0">
            <StatRow
              label="History window"
              value={`${prediction.historyMonths} months`}
              detail="latest available"
            />
            <StatRow
              label="Monthly trajectory"
              value={formatSigned(prediction.monthlySlope, true)}
              detail="linear slope"
            />
            <StatRow
              label="Residual variation"
              value={currency.format(prediction.residualVariation)}
              detail="around trend"
            />
            <StatRow
              label="Trend fit"
              value={`${(prediction.fit * 100).toFixed(1)}%`}
              detail="R²"
            />
            <div className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              The range widens further into the future because uncertainty
              compounds with the projection horizon.
            </div>
          </CardContent>
        </Card>
      </section>
      <Alert role="note">
        <AlertTitle>Trajectory, not a guarantee</AlertTitle>
        <AlertDescription>
          This is a statistical extrapolation of monthly tracked totals. It
          assumes the observed linear trajectory continues. Deposits,
          withdrawals, transfers, market movement, missing balances, and new
          accounts remain mixed together and can move the outcome outside the
          displayed range.
        </AlertDescription>
      </Alert>
    </>
  );
}

function Accounts({
  accounts,
  accountLabels,
  accountRoles,
  accountLastObserved,
  marketData,
  months,
  historyMonths,
  latest,
  previous,
}: {
  accounts: string[];
  accountLabels: Record<string, string>;
  accountRoles: Record<string, "cash" | "investment">;
  accountLastObserved: Record<string, string>;
  marketData: MoneyTrackerPageData["marketData"];
  months: GroupedMonth[];
  historyMonths: GroupedMonth[];
  latest?: GroupedMonth;
  previous?: GroupedMonth;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "cash" | "investment">("all");
  const [sort, setSort] = useState<MoneySort<AccountSortKey>>({
    key: "value",
    direction: "desc",
  });
  const [selectedAccount, setSelectedAccount] = useState<string>();
  const [accountHistoryRange, setAccountHistoryRange] =
    useState<AccountHistoryRange>("5y");
  const [accountActivity, setAccountActivity] = useState<
    MoneyActivityPage["items"]
  >([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string>();
  const first = months.at(0);
  const cashAccounts = accounts.filter(
    (account) => roleCategory(accountRoles, account) === "money",
  );
  const investmentAccounts = accounts.filter(
    (account) => roleCategory(accountRoles, account) === "stocks",
  );
  const chartCashAccounts = cashAccounts.filter(
    (account) => accountLastObserved[account] !== undefined,
  );
  const chartInvestmentAccounts = investmentAccounts.filter(
    (account) => accountLastObserved[account] !== undefined,
  );
  const snapshotAccounts = accounts.filter(
    (account) => accountLastObserved[account] !== undefined,
  );
  const rows = accountRows(accounts, accountLabels, latest, previous).map(
    (row) => {
      const firstValue = first?.values[row.account];
      const comparable =
        first?.observedAccounts.includes(row.account) &&
        latest?.observedAccounts.includes(row.account);
      const periodChange =
        comparable && row.value !== undefined && firstValue !== undefined
          ? row.value - firstValue
          : undefined;
      const range = rangeValuesForAccount(months, row.account);
      return {
        ...row,
        category:
          accountRoles[row.account] === "investment" ? "Investment" : "Cash",
        firstValue,
        periodChange,
        latestPercent: percent(row.change, row.previous),
        periodPercent: percent(periodChange, firstValue),
        share:
          latest?.total && row.value !== undefined
            ? (row.value / latest.total) * 100
            : undefined,
        lastObserved: accountLastObserved[row.account],
        rangeMin: range?.minimum,
        rangeMax: range?.maximum,
      };
    },
  );
  const normalizedQuery = query.trim().toLocaleLowerCase("en-GB");
  const visibleRows = rows
    .filter(
      (row) =>
        (scope === "all" || accountRoles[row.account] === scope) &&
        (!normalizedQuery ||
          row.label.toLocaleLowerCase("en-GB").includes(normalizedQuery)),
    )
    .sort((left, right) => compareAccountRows(left, right, sort));
  const observedCount = latest
    ? accounts.filter((account) => latest.observedAccounts.includes(account))
        .length
    : 0;
  const selectedRow = rows.find((row) => row.account === selectedAccount);
  const selectedHistory = selectedAccount
    ? historyMonths
        .filter((month) => month.values[selectedAccount] !== undefined)
        .map((month) => ({
          date: month.date,
          value: month.values[selectedAccount]!,
          observed: month.observedAccounts.includes(selectedAccount),
        }))
        .reverse()
    : [];
  const selectedHistoryAscending = [...selectedHistory].reverse();
  const visibleSelectedHistory =
    accountHistoryRange === "all"
      ? selectedHistoryAscending
      : selectedHistoryAscending.slice(
          accountHistoryRange === "1y" ? -13 : -61,
        );
  const selectedHistoryChange =
    visibleSelectedHistory.length > 1
      ? visibleSelectedHistory.at(-1)!.value -
        visibleSelectedHistory[0]!.value
      : undefined;
  const changeSort = (key: AccountSortKey) =>
    setSort((current) =>
      nextMoneySort(current, key, ["label", "category", "lastObserved"]),
    );
  useEffect(() => {
    if (!selectedAccount) {
      setAccountActivity([]);
      setActivityError(undefined);
      return;
    }
    const controller = new AbortController();
    setActivityLoading(true);
    setActivityError(undefined);
    const parameters = new URLSearchParams({
      query: "",
      accountId: selectedAccount,
      sort: "date",
      direction: "desc",
      offset: "0",
      limit: "50",
    });
    void fetch(`/api/money/activity?${parameters}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as MoneyActivityPage & {
          message?: string;
        };
        if (!response.ok)
          throw new Error(
            body.message ??
              `Money request failed with status ${response.status}.`,
          );
        setAccountActivity(body.items);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setActivityError(
            error instanceof Error
              ? error.message
              : "Account activity could not be loaded.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setActivityLoading(false);
      });
    return () => controller.abort();
  }, [selectedAccount]);
  return (
    <>
      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Account summary"
      >
        <Metric
          label="Tracked cash"
          value={latest ? currency.format(latest.money) : "No data"}
          detail={`${cashAccounts.length} cash accounts · ${latest?.date ?? "no snapshot"}`}
        />
        <Metric
          label="Portfolio value"
          value={formatMinor(marketData.totals.knownMarketValueMinor, "EUR")}
          detail={`${marketData.positions.filter((position) => position.marketValueMinor !== undefined).length} / ${marketData.positions.length} positions priced`}
        />
        <Metric
          label="Accounts with balances"
          value={`${snapshotAccounts.length} / ${accounts.length}`}
          detail={`${accounts.length - snapshotAccounts.length} transaction-only accounts`}
        />
        <Metric
          label="Latest balance coverage"
          value={`${observedCount} updated`}
          detail={`${Math.max(0, snapshotAccounts.length - observedCount)} reused from an earlier month`}
        />
      </section>
      <section
        className={`grid items-start gap-3 ${chartInvestmentAccounts.length ? "xl:grid-cols-2" : ""}`}
        aria-label="Balance history"
      >
        <AccountGroupChart
          title="Cash history"
          category="money"
          accounts={chartCashAccounts}
          accountLabels={accountLabels}
          months={months}
          first={first}
          latest={latest}
        />
        {chartInvestmentAccounts.length ? (
          <AccountGroupChart
            title="Investment balance history"
            category="stocks"
            accounts={chartInvestmentAccounts}
            accountLabels={accountLabels}
            months={months}
            first={first}
            latest={latest}
          />
        ) : null}
      </section>
      <Card>
        <CardHeader className="gap-4 border-b">
          <div>
            <CardTitle>Accounts</CardTitle>
            <CardDescription>
              Filter and sort balances, movement, allocation, and freshness
            </CardDescription>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div
              className="flex w-fit rounded-lg bg-muted p-1"
              aria-label="Account type filter"
            >
              {(["all", "cash", "investment"] as const).map((item) => (
                <Button
                  key={item}
                  type="button"
                  size="sm"
                  variant={scope === item ? "secondary" : "ghost"}
                  className="h-7 capitalize"
                  aria-pressed={scope === item}
                  onClick={() => setScope(item)}
                >
                  {item === "all"
                    ? `All ${accounts.length}`
                    : `${item === "cash" ? "Cash" : "Investments"} ${item === "cash" ? cashAccounts.length : investmentAccounts.length}`}
                </Button>
              ))}
            </div>
            <MoneyTableSearch
              value={query}
              onValue={setQuery}
              placeholder="Filter accounts…"
            />
          </div>
        </CardHeader>
        <CardContent
          className="overflow-x-auto p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={0}
          role="region"
          aria-label="Account detail table"
        >
          <table className="w-full min-w-[68rem] text-sm">
            <caption className="sr-only">
              Balances, changes, allocation and observation dates by account
            </caption>
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <MoneySortableHead
                  label="Account"
                  sortKey="label"
                  active={sort}
                  onSort={changeSort}
                />
                <MoneySortableHead
                  label="Category"
                  sortKey="category"
                  active={sort}
                  onSort={changeSort}
                />
                <MoneySortableHead
                  label="Balance"
                  sortKey="value"
                  active={sort}
                  onSort={changeSort}
                  align="right"
                />
                <MoneySortableHead
                  label="Latest"
                  sortKey="change"
                  active={sort}
                  onSort={changeSort}
                  align="right"
                />
                <MoneySortableHead
                  label="Latest %"
                  sortKey="latestPercent"
                  active={sort}
                  onSort={changeSort}
                  align="right"
                />
                <MoneySortableHead
                  label="Selected period"
                  sortKey="periodChange"
                  active={sort}
                  onSort={changeSort}
                  align="right"
                />
                <MoneySortableHead
                  label="Period %"
                  sortKey="periodPercent"
                  active={sort}
                  onSort={changeSort}
                  align="right"
                />
                <MoneySortableHead
                  label="Share"
                  sortKey="share"
                  active={sort}
                  onSort={changeSort}
                  align="right"
                />
                <MoneySortableHead
                  label="Last observed"
                  sortKey="lastObserved"
                  active={sort}
                  onSort={changeSort}
                  align="right"
                />
                <MoneySortableHead
                  label="Tracked range"
                  sortKey="rangeMax"
                  active={sort}
                  onSort={changeSort}
                  align="right"
                />
              </tr>
            </thead>
            <tbody className="divide-y">
              {visibleRows.map((row) => (
                <tr
                  className="transition-colors hover:bg-muted/40"
                  key={row.account}
                >
                  <td className="px-4 py-3 font-medium">
                    <button
                      type="button"
                      className="group inline-flex items-center gap-1.5 rounded-sm text-left underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                      onClick={() => setSelectedAccount(row.account)}
                    >
                      {row.label}
                      <ChevronRight
                        className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{row.category}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {row.value === undefined ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      preciseCurrency.format(row.value)
                    )}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${changeClass(row.change)}`}
                  >
                    {formatSigned(row.change, true)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${changeClass(row.change)}`}
                  >
                    {formatTrendPercent(row.latestPercent)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${changeClass(row.periodChange)}`}
                  >
                    {formatSigned(row.periodChange, true)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${changeClass(row.periodChange)}`}
                  >
                    {formatTrendPercent(row.periodPercent)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {row.share === undefined ? "—" : `${row.share.toFixed(1)}%`}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                    {row.lastObserved ?? "No snapshot"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                    {row.rangeMin === undefined || row.rangeMax === undefined
                      ? "—"
                      : `${currency.format(row.rangeMin)} – ${currency.format(row.rangeMax)}`}
                  </td>
                </tr>
              ))}
              {visibleRows.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-10 text-center text-muted-foreground"
                    colSpan={10}
                  >
                    No accounts match this filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Sheet
        open={selectedAccount !== undefined}
        onOpenChange={(open) => {
          if (!open) setSelectedAccount(undefined);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader className="border-b pr-12">
            <SheetTitle>{selectedRow?.label ?? "Account"}</SheetTitle>
            <SheetDescription>
              {selectedRow
                ? `${selectedRow.category} account · EUR`
                : "Account details"}
            </SheetDescription>
          </SheetHeader>
          {selectedRow ? (
            <Tabs defaultValue="overview" className="px-4 pb-5">
              <TabsList variant="line">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
                <TabsTrigger value="history">Balance history</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="space-y-4 pt-3">
                <section className="grid gap-2 sm:grid-cols-3">
                  <SheetMetric
                    label="Balance"
                    value={
                      selectedRow.value === undefined
                        ? "No snapshot"
                        : preciseCurrency.format(selectedRow.value)
                    }
                  />
                  <SheetMetric
                    label="Latest change"
                    value={formatSigned(selectedRow.change, true)}
                    tone={selectedRow.change}
                  />
                  <SheetMetric
                    label="Tracked total share"
                    value={
                      selectedRow.share === undefined
                        ? "—"
                        : `${selectedRow.share.toFixed(1)}%`
                    }
                  />
                </section>
                {selectedRow.value === undefined ? (
                  <Alert>
                    <AlertTitle>Transaction activity only</AlertTitle>
                    <AlertDescription>
                      This import identifies the account and its transactions,
                      but contains no running or closing balance. Import a
                      balance snapshot to add balance metrics and history.
                    </AlertDescription>
                  </Alert>
                ) : null}
                <Card>
                  <CardContent className="divide-y p-0">
                    <StatRow
                      label="Last observed"
                      value={selectedRow.lastObserved ?? "No snapshot"}
                    />
                    <StatRow
                      label="Selected-period change"
                      value={formatSigned(selectedRow.periodChange, true)}
                    />
                    <StatRow
                      label="Tracked range"
                      value={
                        selectedRow.rangeMin === undefined ||
                        selectedRow.rangeMax === undefined
                          ? "—"
                          : `${preciseCurrency.format(selectedRow.rangeMin)} – ${preciseCurrency.format(selectedRow.rangeMax)}`
                      }
                    />
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="activity" className="pt-3">
                {activityLoading ? (
                  <p className="py-8 text-center text-muted-foreground">
                    Loading activity…
                  </p>
                ) : activityError ? (
                  <Alert variant="destructive">
                    <AlertTitle>Activity not loaded</AlertTitle>
                    <AlertDescription>{activityError}</AlertDescription>
                  </Alert>
                ) : accountActivity.length ? (
                  <div className="divide-y rounded-lg border">
                    {accountActivity.map((item) => (
                      <div
                        className="flex items-start justify-between gap-4 p-3"
                        key={item.id}
                      >
                        <div className="min-w-0">
                          <strong className="block truncate">
                            {item.description}
                          </strong>
                          <span className="text-xs text-muted-foreground">
                            {new Date(item.occurredAt).toLocaleDateString(
                              "en-GB",
                            )}{" "}
                            · {item.flowKind} · {item.category}
                          </span>
                        </div>
                        <strong
                          className={`shrink-0 font-mono ${changeClass(item.amountMinor)}`}
                        >
                          {formatMinor(item.amountMinor, item.currency)}
                        </strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-8 text-center text-muted-foreground">
                    No activity imported for this account.
                  </p>
                )}
              </TabsContent>
              <TabsContent value="history" className="pt-3">
                {visibleSelectedHistory.length ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <strong className="text-sm">Balance over time</strong>
                        <p
                          className={`mt-1 font-mono text-xs ${changeClass(selectedHistoryChange)}`}
                        >
                          {formatSigned(selectedHistoryChange, true)} in selected
                          range
                        </p>
                      </div>
                      <AccountHistoryRangeSelector
                        range={accountHistoryRange}
                        onRange={setAccountHistoryRange}
                      />
                    </div>
                    <MountedChart
                      fallback={
                        <ChartFallback
                          values={visibleSelectedHistory.map(
                            (item) => item.value,
                          )}
                        />
                      }
                    >
                      <ChartContainer
                        config={accountBalanceConfig}
                        className="h-64 w-full aspect-auto"
                        role="img"
                        aria-label={`${selectedRow.label} balance history for the selected range. Exact monthly balances follow the chart.`}
                      >
                        <ComposedChart
                          accessibilityLayer={false}
                          data={visibleSelectedHistory}
                          margin={{ left: 2, right: 10, top: 8 }}
                        >
                          <CartesianGrid vertical={false} />
                          <XAxis
                            dataKey="date"
                            tickLine={false}
                            axisLine={false}
                            minTickGap={24}
                          />
                          <YAxis
                            tickLine={false}
                            axisLine={false}
                            width={68}
                            tickFormatter={(value: number) =>
                              currency.format(value)
                            }
                          />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                formatter={(value) => (
                                  <TooltipValue
                                    label="Balance"
                                    value={preciseCurrency.format(
                                      Number(value),
                                    )}
                                  />
                                )}
                              />
                            }
                          />
                          <Area
                            dataKey="value"
                            name="Balance"
                            type="monotone"
                            fill={colors[0]}
                            fillOpacity={0.16}
                            stroke={colors[0]}
                            strokeWidth={2.5}
                            dot={visibleSelectedHistory.length === 1}
                          />
                        </ComposedChart>
                      </ChartContainer>
                    </MountedChart>
                    <div className="max-h-[45vh] overflow-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <caption className="sr-only">
                          Exact account balances plotted in the chart
                        </caption>
                        <thead className="sticky top-0 border-b bg-popover text-xs text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 text-left">Month</th>
                            <th className="px-3 py-2 text-right">Balance</th>
                            <th className="px-3 py-2 text-right">Source</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {[...visibleSelectedHistory]
                            .reverse()
                            .map((item) => (
                              <tr key={item.date}>
                                <td className="px-3 py-2">{item.date}</td>
                                <td className="px-3 py-2 text-right font-mono">
                                  {preciseCurrency.format(item.value)}
                                </td>
                                <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                                  {item.observed ? "Observed" : "Reused"}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <Alert>
                    <AlertTitle>No balance history available</AlertTitle>
                    <AlertDescription>
                      This is a transaction-only account. Its imported source
                      does not contain running or closing balances, so there is
                      nothing reliable to plot yet.
                    </AlertDescription>
                  </Alert>
                )}
              </TabsContent>
            </Tabs>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

type AccountSortKey =
  | "label"
  | "category"
  | "value"
  | "change"
  | "latestPercent"
  | "periodChange"
  | "periodPercent"
  | "share"
  | "lastObserved"
  | "rangeMax";
type HistorySortKey =
  | "date"
  | "total"
  | "change"
  | "money"
  | "stocks"
  | "coverage"
  | `account:${string}`;
function compareAccountRows<
  Row extends { label: string } & Record<
    AccountSortKey,
    string | number | undefined
  >,
>(left: Row, right: Row, sort: MoneySort<AccountSortKey>) {
  const a = left[sort.key];
  const b = right[sort.key];
  return (
    compareMoneyValues(a, b, sort.direction) ||
    left.label.localeCompare(right.label)
  );
}

function AccountGroupChart({
  title,
  category,
  accounts,
  accountLabels,
  months,
  first,
  latest,
}: {
  title: string;
  category: MoneyTrackerAccountCategory;
  accounts: string[];
  accountLabels: Record<string, string>;
  months: GroupedMonth[];
  first?: GroupedMonth;
  latest?: GroupedMonth;
}) {
  const dataKey = category === "money" ? "money" : "stocks";
  const label = category === "money" ? "Cash" : "Stocks";
  const palette =
    category === "money"
      ? ["#67e8f9", "#60a5fa", "#34d399", "#facc15", "#fb923c"]
      : ["#c084fc", "#f472b6", "#a78bfa"];
  const config = {
    ...Object.fromEntries(
      accounts.map((account) => [
        account,
        { label: accountLabels[account] ?? account },
      ]),
    ),
    [dataKey]: { label: `${label} total` },
  } satisfies ChartConfig;
  const startValue = first?.[dataKey];
  const latestValue = latest?.[dataKey];
  const comparable =
    accounts.length > 0 &&
    accounts.every(
      (account) =>
        first?.observedAccounts.includes(account) &&
        latest?.observedAccounts.includes(account),
    );
  const periodChange =
    comparable && startValue !== undefined && latestValue !== undefined
      ? latestValue - startValue
      : undefined;
  return (
    <ChartCard
      title={title}
      description={`${latestValue === undefined ? "No data" : preciseCurrency.format(latestValue)} latest tracked · ${formatSigned(periodChange, true)} in the selected period`}
    >
      <MountedChart
        fallback={
          <ChartFallback values={months.map((month) => month[dataKey])} />
        }
      >
        <ChartContainer
          config={config}
          className="h-72 w-full aspect-auto"
          role="img"
          aria-label={`${label} balances by account over the selected period. Exact values follow in an expandable table.`}
        >
          <ComposedChart accessibilityLayer={false} data={months}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={68}
              tickFormatter={(value: number) => currency.format(value)}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            {accounts.map((account, index) => (
              <Area
                key={account}
                dataKey={`values.${account}`}
                name={accountLabels[account] ?? account}
                type="monotone"
                stackId={dataKey}
                fill={palette[index % palette.length]}
                fillOpacity={0.62}
                stroke={palette[index % palette.length]}
                strokeWidth={1.5}
              />
            ))}
            <Line
              dataKey={dataKey}
              name={`${label} total`}
              type="monotone"
              stroke="#fafafa"
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ChartContainer>
      </MountedChart>
      <AccountDataDisclosure
        months={months}
        accounts={accounts}
        accountLabels={accountLabels}
        totalKey={dataKey}
        totalLabel={`${label} total`}
      />
    </ChartCard>
  );
}

export function History({
  accounts,
  accountLabels,
  months,
}: {
  accounts: string[];
  accountLabels: Record<string, string>;
  months: GroupedMonth[];
}) {
  const [sort, setSort] = useState<MoneySort<HistorySortKey>>({
    key: "date",
    direction: "desc",
  });
  const changes = months
    .slice(1)
    .flatMap((month, index) =>
      sameBalanceCoverage(month, months[index]!)
        ? [{ ...month, change: month.total - months[index]!.total }]
        : [],
    );
  const latest = months.at(-1);
  const previous = months.at(-2);
  const latestChange =
    latest && previous && sameBalanceCoverage(latest, previous)
      ? latest.total - previous.total
      : undefined;
  const latestReused = latest
    ? accounts.filter(
        (account) =>
          latest.values[account] !== undefined &&
          !latest.observedAccounts.includes(account),
      ).length
    : 0;
  const largestIncrease = changes.length
    ? changes.reduce((best, item) => (item.change > best.change ? item : best))
    : undefined;
  const largestDecrease = changes.length
    ? changes.reduce((best, item) => (item.change < best.change ? item : best))
    : undefined;
  const comparableMonths = months.filter((month) =>
    accounts.every((account) => month.values[account] !== undefined),
  );
  const high = comparableMonths.length
    ? comparableMonths.reduce((best, item) =>
        item.total > best.total ? item : best,
      )
    : undefined;
  const low = comparableMonths.length
    ? comparableMonths.reduce((best, item) =>
        item.total < best.total ? item : best,
      )
    : undefined;
  const historyRows = months
    .map((month, index) => {
      const older = months[index - 1];
      const reused = accounts.filter(
        (account) =>
          month.values[account] !== undefined &&
          !month.observedAccounts.includes(account),
      ).length;
      const unavailable = accounts.filter(
        (account) => month.values[account] === undefined,
      ).length;
      return {
        month,
        change:
          older && sameBalanceCoverage(month, older)
            ? month.total - older.total
            : undefined,
        reused,
        unavailable,
      };
    })
    .sort((left, right) => {
      const value = (row: typeof left) =>
        sort.key === "date"
          ? row.month.date
          : sort.key === "total"
            ? row.month.total
            : sort.key === "change"
              ? row.change
              : sort.key === "money"
                ? row.month.money
                : sort.key === "stocks"
                  ? row.month.stocks
                  : sort.key === "coverage"
                    ? row.reused + row.unavailable
                    : row.month.values[sort.key.slice("account:".length)];
      return (
        compareMoneyValues(value(left), value(right), sort.direction) ||
        right.month.date.localeCompare(left.month.date)
      );
    });
  const changeSort = (key: HistorySortKey) =>
    setSort((current) => nextMoneySort(current, key, ["date"]));
  return (
    <>
      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="History summary"
      >
        <Metric
          label="Balance months"
          value={String(months.length)}
          detail={
            months.length
              ? `${months[0]!.date} to ${months.at(-1)!.date}`
              : undefined
          }
        />
        <Metric
          label="Latest account balances"
          value={latest ? currency.format(latest.total) : "No data"}
          detail={latest?.date}
        />
        <Metric
          label="Latest recorded movement"
          value={formatSigned(latestChange)}
          detail={
            latestChange !== undefined && latest && previous
              ? `${previous.date} to ${latest.date} · ${latestReused} reused`
              : "Not comparable: account coverage changed"
          }
          tone={tone(latestChange)}
        />
        <Metric
          label="Latest coverage"
          value={
            latest ? `${latest.observedAccounts.length} updated` : "No data"
          }
          detail={`${latestReused} reused from earlier observations`}
        />
      </section>
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Monthly snapshot ledger</CardTitle>
          <CardDescription>
            Click a header to sort. “Reused” means the most recent earlier
            balance was used because no new statement balance was available that
            month.
          </CardDescription>
        </CardHeader>
        <CardContent
          className="overflow-x-auto p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={0}
          role="region"
          aria-label="Monthly balance snapshot table"
        >
          <table className="w-full min-w-max text-sm">
            <caption className="sr-only">
              Monthly balances with observation coverage
            </caption>
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <MoneySortableHead
                  label="Date"
                  sortKey="date"
                  active={sort}
                  onSort={changeSort}
                  className="sticky left-0 z-10 bg-card"
                />
                <MoneySortableHead
                  label="Tracked total"
                  sortKey="total"
                  active={sort}
                  onSort={changeSort}
                  align="right"
                />
                <MoneySortableHead
                  label="Change"
                  sortKey="change"
                  active={sort}
                  onSort={changeSort}
                  align="right"
                />
                <MoneySortableHead
                  label="Cash"
                  sortKey="money"
                  active={sort}
                  onSort={changeSort}
                  align="right"
                />
                <MoneySortableHead
                  label="Investment account balances"
                  sortKey="stocks"
                  active={sort}
                  onSort={changeSort}
                  align="right"
                />
                {accounts.map((account) => (
                  <MoneySortableHead
                    label={accountLabels[account] ?? account}
                    sortKey={`account:${account}`}
                    active={sort}
                    onSort={changeSort}
                    align="right"
                    key={account}
                  />
                ))}
                <MoneySortableHead
                  label="Balance source"
                  sortKey="coverage"
                  active={sort}
                  onSort={changeSort}
                  align="right"
                />
              </tr>
            </thead>
            <tbody className="divide-y">
              {historyRows.map(({ month, change, reused }) => (
                <tr className="hover:bg-muted/30" key={month.date}>
                  <td className="sticky left-0 bg-card px-4 py-3 font-medium">
                    {month.date}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-medium">
                    {preciseCurrency.format(month.total)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${changeClass(change)}`}
                  >
                    {formatSigned(change, true)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {preciseCurrency.format(month.money)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {preciseCurrency.format(month.stocks)}
                  </td>
                  {accounts.map((account) => (
                    <td
                      className="px-4 py-3 text-right font-mono"
                      key={account}
                    >
                      {month.values[account] === undefined ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        preciseCurrency.format(month.values[account])
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">
                    <Badge variant="outline">
                      {reused === 0 ? "Updated" : `${reused} reused`}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <section className="grid items-start gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Selected-period extremes</CardTitle>
            <CardDescription>
              Tracked balances, including reused values where noted in the
              ledger
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y p-0">
            <StatRow
              label="Largest increase"
              value={formatSigned(largestIncrease?.change, true)}
              detail={largestIncrease?.date}
            />
            <StatRow
              label="Largest decrease"
              value={formatSigned(largestDecrease?.change, true)}
              detail={largestDecrease?.date}
            />
            <StatRow
              label="Highest tracked balance"
              value={high ? preciseCurrency.format(high.total) : "—"}
              detail={high?.date}
            />
            <StatRow
              label="Lowest tracked balance"
              value={low ? preciseCurrency.format(low.total) : "—"}
              detail={low?.date}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Data contract</CardTitle>
            <CardDescription>What these analytics can assert</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-5 text-sm">
            <p>
              <strong>{accounts.length}</strong> tracked accounts across{" "}
              <strong>{months.length}</strong> monthly snapshots.
            </p>
            <p>
              <strong>Cash and investments</strong> use the persisted account
              role, never the account label.
            </p>
            <p className="text-muted-foreground">
              Missing monthly observations are carried forward and labeled as
              such. Balance changes are not investment returns: deposits,
              withdrawals, and market performance cannot be separated from
              snapshots alone.
            </p>
            <Alert>
              <AlertTitle>Money-owned history</AlertTitle>
              <AlertDescription>
                Imported running balances and manual snapshots are stored in the
                private Money ledger.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </section>
    </>
  );
}

function BalanceChart({
  months,
  period,
  onPeriod,
}: {
  months: GroupedMonth[];
  period: Period;
  onPeriod: (period: Period) => void;
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Tracked net worth</CardTitle>
            <CardDescription>
              Actual monthly total, composed from cash and reported investment
              balances
            </CardDescription>
          </div>
          <PeriodSelector period={period} onPeriod={onPeriod} />
        </div>
      </CardHeader>
      <CardContent className="pt-5">
        <MountedChart
          fallback={
            <ChartFallback values={months.map((month) => month.total)} />
          }
        >
          <ChartContainer
            config={totalConfig}
            className="h-[23rem] w-full aspect-auto"
            initialDimension={{ width: 760, height: 368 }}
            role="img"
            aria-label="Tracked total over time, composed from cash and reported investment balances. Exact values follow in an expandable table."
          >
            <ComposedChart
              accessibilityLayer={false}
              data={months}
              margin={{ left: 4, right: 12, top: 8 }}
            >
              <defs>
                <linearGradient
                  id="money-overview-cash"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="5%" stopColor={colors[0]} stopOpacity={0.34} />
                  <stop offset="95%" stopColor={colors[0]} stopOpacity={0.04} />
                </linearGradient>
                <linearGradient
                  id="money-overview-stocks"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="5%" stopColor={colors[1]} stopOpacity={0.34} />
                  <stop offset="95%" stopColor={colors[1]} stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                minTickGap={28}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={72}
                tickFormatter={(value: number) => currency.format(value)}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                dataKey="money"
                name="Cash"
                type="monotone"
                stackId="tracked"
                fill="url(#money-overview-cash)"
                stroke={colors[0]}
                strokeWidth={1.5}
              />
              <Area
                dataKey="stocks"
                name="Investment balances"
                type="monotone"
                stackId="tracked"
                fill="url(#money-overview-stocks)"
                stroke={colors[1]}
                strokeWidth={1.5}
              />
              <Line
                dataKey="total"
                name="Tracked total"
                type="monotone"
                stroke="#fafafa"
                strokeWidth={2.5}
                dot={false}
              />
            </ComposedChart>
          </ChartContainer>
        </MountedChart>
        <BalanceDataDisclosure months={months} />
      </CardContent>
    </Card>
  );
}

function AttentionRow({
  label,
  value,
  detail,
  ready,
  view,
  action,
  search,
}: {
  label: string;
  value: string;
  detail: string;
  ready: boolean;
  view: Exclude<MoneyTrackerView, "overview">;
  action: string;
  search?: { category?: MoneyCategory; review?: boolean };
}) {
  const details = (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
  return ready ? (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
      {details}
      <Badge variant="outline">{value}</Badge>
    </div>
  ) : (
    <Link
      to="/money"
      search={{ view, ...search }}
      className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 ${MONEY_ROW_ACTION_CLASS}`}
    >
      {details}
      <Badge variant="destructive">{value}</Badge>
      <MoneyRowActionCue label={action} />
    </Link>
  );
}

function CashFlowBar({
  label,
  value,
  maximum,
  tone: barTone,
}: {
  label: string;
  value: number;
  maximum: number;
  tone: "income" | "spend";
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{formatMinor(value, "EUR")}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={
            barTone === "income"
              ? "h-full rounded-full bg-emerald-400"
              : "h-full rounded-full bg-cyan-300"
          }
          style={{ width: `${(value / maximum) * 100}%` }}
        />
      </div>
    </div>
  );
}

function viewDescription(view: MoneyTrackerView) {
  return view === "overview"
    ? "Your tracked financial position, recent cash flow, freshness, and open review work."
    : view === "cash-flow"
      ? "Income, spending, and imported monthly cash-flow activity."
      : view === "transactions"
        ? "The normalized ledger with complete search, classification, and transfer review."
        : view === "investments"
          ? "Current EUR valuation, historical closes, FIFO performance, and imported activity."
          : view === "accounts"
            ? "Cash balances, observation freshness, concentration, and monthly history."
            : view === "categories"
              ? "Explore spending by category, month, merchant, and underlying transaction."
              : view === "insights"
                ? "Balance momentum, concentration, drawdown, trends, and a conservative run-rate scenario."
                : view === "predictions"
                  ? "A projected net-worth range based on the trajectory and variability in your monthly history."
                  : "Imports, reconciliation, coverage, rules, and analytical limits.";
}
function PeriodSelector({
  period,
  onPeriod,
}: {
  period: Period;
  onPeriod: (period: Period) => void;
}) {
  return (
    <div role="group" aria-label="Balance range" className="flex gap-1">
      <PeriodButton active={period === "6m"} onClick={() => onPeriod("6m")}>
        6M
      </PeriodButton>
      <PeriodButton active={period === "1y"} onClick={() => onPeriod("1y")}>
        1Y
      </PeriodButton>
      <PeriodButton active={period === "5y"} onClick={() => onPeriod("5y")}>
        5Y
      </PeriodButton>
      <PeriodButton active={period === "all"} onClick={() => onPeriod("all")}>
        All
      </PeriodButton>
    </div>
  );
}
function AccountHistoryRangeSelector({
  range,
  onRange,
}: {
  range: AccountHistoryRange;
  onRange: (range: AccountHistoryRange) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Account balance history range"
      className="flex gap-1"
    >
      {(["1y", "5y", "all"] as const).map((value) => (
        <PeriodButton
          key={value}
          active={range === value}
          onClick={() => onRange(value)}
        >
          {value === "all" ? "All" : value.toUpperCase()}
        </PeriodButton>
      ))}
    </div>
  );
}
function PeriodButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-5">{children}</CardContent>
    </Card>
  );
}
function MountedChart({
  children,
}: {
  fallback: React.ReactNode;
  children: React.ReactNode;
}) {
  return children;
}
function ChartFallback({ values }: { values: number[] }) {
  const latest = values.at(-1);
  return (
    <div className="grid h-64 place-items-center rounded-md border border-dashed bg-muted/40 text-center">
      <div>
        <p className="text-sm font-medium">Chart loading</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {latest === undefined
            ? "No chart data"
            : `Latest value ${currency.format(latest)}`}
        </p>
      </div>
    </div>
  );
}
function BalanceDataDisclosure({
  months,
  includeTrend = false,
}: {
  months: GroupedMonth[];
  includeTrend?: boolean;
}) {
  return (
    <ChartDataDetails label="View balance chart data">
      <table className="w-full min-w-[34rem] text-xs">
        <caption className="sr-only">
          Exact values plotted in the balance chart
        </caption>
        <thead className="border-b text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Month</th>
            <th className="px-3 py-2 text-right">Cash</th>
            <th className="px-3 py-2 text-right">Investments</th>
            <th className="px-3 py-2 text-right">Tracked total</th>
            {includeTrend ? (
              <th className="px-3 py-2 text-right">Linear trend</th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y">
          {months.map((month) => (
            <tr key={month.date}>
              <td className="px-3 py-2">{month.date}</td>
              <td className="px-3 py-2 text-right font-mono">
                {preciseCurrency.format(month.money)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {preciseCurrency.format(month.stocks)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {preciseCurrency.format(month.total)}
              </td>
              {includeTrend ? (
                <td className="px-3 py-2 text-right font-mono">
                  {preciseCurrency.format(month.trend)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </ChartDataDetails>
  );
}
function PredictionDataDisclosure({
  points,
}: {
  points: MoneyTrajectoryPrediction["forecast"];
}) {
  return (
    <ChartDataDetails label="View prediction data">
      <table className="w-full min-w-[34rem] text-xs">
        <caption className="sr-only">
          Exact central estimate and 80 percent range plotted in the prediction
          chart
        </caption>
        <thead className="border-b text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Month</th>
            <th className="px-3 py-2 text-right">Central estimate</th>
            <th className="px-3 py-2 text-right">Range low</th>
            <th className="px-3 py-2 text-right">Range high</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {points.map((point) => (
            <tr key={point.date}>
              <td className="px-3 py-2">{point.date}</td>
              <td className="px-3 py-2 text-right font-mono">
                {preciseCurrency.format(point.estimate)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {preciseCurrency.format(point.range[0])}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {preciseCurrency.format(point.range[1])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartDataDetails>
  );
}
function ChangeDataDisclosure({
  changes,
}: {
  changes: Array<Month & { change: number }>;
}) {
  return (
    <ChartDataDetails label="View monthly change data">
      <table className="w-full text-xs">
        <caption className="sr-only">
          Exact values plotted in the monthly balance change chart
        </caption>
        <thead className="border-b text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Month</th>
            <th className="px-3 py-2 text-right">Change</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {changes.map((month) => (
            <tr key={month.date}>
              <td className="px-3 py-2">{month.date}</td>
              <td className="px-3 py-2 text-right font-mono">
                {formatSigned(month.change, true)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartDataDetails>
  );
}
function AccountDataDisclosure({
  months,
  accounts,
  accountLabels,
  totalKey,
  totalLabel,
}: {
  months: GroupedMonth[];
  accounts: string[];
  accountLabels: Record<string, string>;
  totalKey: "money" | "stocks";
  totalLabel: string;
}) {
  return (
    <ChartDataDetails label="View account chart data">
      <table className="w-full min-w-max text-xs">
        <caption className="sr-only">
          Exact values plotted in the account history chart
        </caption>
        <thead className="border-b text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Month</th>
            {accounts.map((account) => (
              <th className="px-3 py-2 text-right" key={account}>
                {accountLabels[account] ?? account}
              </th>
            ))}
            <th className="px-3 py-2 text-right">{totalLabel}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {months.map((month) => (
            <tr key={month.date}>
              <td className="px-3 py-2">{month.date}</td>
              {accounts.map((account) => (
                <td className="px-3 py-2 text-right font-mono" key={account}>
                  {month.values[account] === undefined
                    ? "—"
                    : preciseCurrency.format(month.values[account])}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-mono">
                {preciseCurrency.format(month[totalKey])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartDataDetails>
  );
}
function ChartDataDetails({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <details className="mt-3 border-t pt-3">
      <summary className="w-fit cursor-pointer rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {label}
      </summary>
      <div
        className="mt-3 overflow-x-auto rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        tabIndex={0}
        role="region"
        aria-label={label}
      >
        {children}
      </div>
    </details>
  );
}
function Metric({
  label,
  value,
  detail,
  tone: valueTone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "positive" | "negative";
}) {
  return (
    <Card>
      <CardContent className="min-w-0 p-4">
        <p className="text-[.68rem] font-semibold uppercase tracking-[.08em] text-muted-foreground">
          {label}
        </p>
        <strong className="mt-1.5 block break-words text-[clamp(1.25rem,2vw,1.5rem)] tracking-tight">
          {value}
        </strong>
        {detail ? (
          <span
            className={
              valueTone === "negative"
                ? "mt-1 block text-xs text-rose-400"
                : "mt-1 block text-xs text-muted-foreground"
            }
          >
            {detail}
          </span>
        ) : null}
      </CardContent>
    </Card>
  );
}
function SheetMetric({
  label,
  value,
  tone: valueTone,
}: {
  label: string;
  value: string;
  tone?: number;
}) {
  return (
    <div className="rounded-lg border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <strong
        className={`mt-1 block font-mono text-base ${changeClass(valueTone)}`}
      >
        {value}
      </strong>
    </div>
  );
}
function StatRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-mono">
        <strong className="font-medium text-foreground">{value}</strong>
        {detail ? (
          <span className="ml-2 text-xs text-muted-foreground">{detail}</span>
        ) : null}
      </span>
    </div>
  );
}
function TrendRow({
  label,
  change,
}: {
  label: string;
  change?: { change: number; percent?: number };
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right font-mono ${changeClass(change?.change)}`}>
        <strong className="font-medium">
          {formatSigned(change?.change, true)}
        </strong>
        <span className="ml-2 text-xs">
          {formatTrendPercent(change?.percent)}
        </span>
      </span>
    </div>
  );
}
function AllocationRow({
  label,
  money,
  stocks,
}: {
  label: string;
  money: number;
  stocks: number;
}) {
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">
          <span className="text-cyan-300">Cash {money.toFixed(1)}%</span>
          <span className="ml-3 text-purple-300">
            Stocks {stocks.toFixed(1)}%
          </span>
        </span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="bg-cyan-300" style={{ width: `${money}%` }} />
        <div className="bg-purple-400" style={{ width: `${stocks}%` }} />
      </div>
    </div>
  );
}
function TooltipValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-40 items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function withChanges(months: Month[]) {
  return months
    .slice(1)
    .map((month, index) => ({
      ...month,
      change: month.total - months[index]!.total,
    }));
}
function sameBalanceCoverage(left: Month, right: Month) {
  const leftKeys = Object.keys(left.values).sort();
  const rightKeys = Object.keys(right.values).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index])
  );
}
function accountRows(
  accounts: string[],
  labels: Record<string, string>,
  latest?: Month,
  previous?: Month,
) {
  return accounts.map((account) => {
    const value = latest?.values[account];
    const oldValue = previous?.values[account];
    const comparable =
      latest?.observedAccounts.includes(account) &&
      previous?.observedAccounts.includes(account);
    return {
      account,
      label: labels[account] ?? account,
      value,
      previous: oldValue,
      change:
        comparable && value !== undefined && oldValue !== undefined
          ? value - oldValue
          : undefined,
    };
  });
}
function formatActivityDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
}
function addCalendarMonths(value: string, offset: number) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}
function formatMinor(value: number, valueCurrency: string) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: valueCurrency,
  }).format(value / 100);
}
function formatSigned(value?: number, precise = false) {
  if (value === undefined) return "—";
  return `${value >= 0 ? "+" : ""}${(precise ? preciseCurrency : currency).format(value)}`;
}
function formatPercent(change?: number, base?: number) {
  return change === undefined || !base
    ? "—"
    : `${change >= 0 ? "+" : ""}${((change / base) * 100).toFixed(1)}%`;
}
function formatTrendPercent(value?: number) {
  return value === undefined
    ? "—"
    : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}
function formatPoints(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} pp`;
}
function tone(value?: number): "positive" | "negative" | undefined {
  return value === undefined ? undefined : value < 0 ? "negative" : "positive";
}
function changeClass(value?: number) {
  return value === undefined
    ? "text-muted-foreground"
    : value < 0
      ? "text-rose-400"
      : "text-emerald-400";
}
function rangeValuesForAccount(months: Month[], account: string) {
  const values = months
    .map((month) => month.values[account])
    .filter((value): value is number => value !== undefined);
  return values.length
    ? { minimum: Math.min(...values), maximum: Math.max(...values) }
    : undefined;
}
function percent(change?: number, base?: number) {
  return change === undefined || !base ? undefined : (change / base) * 100;
}
function cashMonth(
  month: Month,
  cashAccounts: readonly string[],
): GroupedMonth {
  const values = Object.fromEntries(
    cashAccounts.flatMap((account) =>
      month.values[account] === undefined
        ? []
        : [[account, month.values[account]]],
    ),
  ) as Record<string, number>;
  const observedAccounts = month.observedAccounts.filter((account) =>
    cashAccounts.includes(account),
  );
  const money = Object.values(values).reduce((sum, value) => sum + value, 0);
  return {
    ...month,
    values,
    observedAccounts,
    total: money,
    money,
    stocks: 0,
    trend: money,
  };
}
function cashCoverage(
  month: Month | undefined,
  cashAccounts: readonly string[],
) {
  const tracked = cashAccounts.filter(
    (account) =>
      month?.observedAccounts.includes(account) ||
      (month?.values[account] ?? 0) !== 0,
  );
  return {
    observedCashAccountCount: tracked.filter((account) =>
      month?.observedAccounts.includes(account),
    ).length,
    cashAccountCount: tracked.length,
  };
}
function roleCategory(
  roles: Record<string, "cash" | "investment">,
  account: string,
): MoneyTrackerAccountCategory {
  return roles[account] === "investment" ? "stocks" : "money";
}
function withLinearTrend(months: GroupedMonth[]) {
  if (months.length < 2) return months;
  const meanX = (months.length - 1) / 2;
  const meanY =
    months.reduce((sum, month) => sum + month.total, 0) / months.length;
  const slopeNumerator = months.reduce(
    (sum, month, index) => sum + (index - meanX) * (month.total - meanY),
    0,
  );
  const slopeDenominator = months.reduce(
    (sum, _month, index) => sum + (index - meanX) ** 2,
    0,
  );
  const slope = slopeNumerator / slopeDenominator;
  return months.map((month, index) => ({
    ...month,
    trend: meanY + slope * (index - meanX),
  }));
}
