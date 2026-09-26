"use client";

import { useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { MoneyTrackerPageData } from "../src/protected-data.js";
import type { MoneyCategory } from "./money-enums.js";
import { buttonVariants } from "../src/components/ui/button.js";
import { CategoryValue, moneyCategoryLabel } from "./money-category-picker.js";
import {
  EmptyState,
  FlowChart,
  flowTooltip,
  formatDay,
  formatMinor,
  formatMonth,
  formatRatio,
  Legend,
  LegendItem,
  MoneyPanel,
  MonthBars,
  PanelBody,
  Segmented,
  SERIES,
  ShareBar,
  SparkBars,
  Stat,
  StatStrip,
  TableTwin,
  toneClass,
} from "./money-ui.js";

type Range = "12" | "24" | "all";

/** Cash flow and categories in one view. Selecting a month filters the categories. */
export function MoneySpendingView({
  spending,
  transferReview,
  reviewCounts,
  initialCategory,
}: Pick<MoneyTrackerPageData, "spending" | "transferReview" | "reviewCounts"> & { initialCategory?: MoneyCategory }) {
  const router = useRouter();
  const [range, setRange] = useState<Range>("12");
  const [selectedMonth, setSelectedMonth] = useState<string>();
  const observed = spending.months.filter((month) => month.observed);
  const months = range === "all" ? observed : observed.slice(-Number(range));
  const monthKeys = months.map((month) => month.month);
  const month = months.find((item) => item.month === selectedMonth);
  const inRange = new Set(monthKeys);
  const categories = (() => {
    const byCategory = new Map<MoneyCategory, Map<string, number>>();
    for (const row of spending.categoryMonths) {
      if (!inRange.has(row.month)) continue;
      const series = byCategory.get(row.category) ?? new Map<string, number>();
      series.set(row.month, (series.get(row.month) ?? 0) + row.amountMinor);
      byCategory.set(row.category, series);
    }
    return [...byCategory].map(([category, series]) => {
      const values = monthKeys.map((key) => series.get(key) ?? 0);
      const total = values.reduce((sum, value) => sum + value, 0);
      return { category, values, total, average: total / Math.max(monthKeys.length, 1), value: selectedMonth ? series.get(selectedMonth) ?? 0 : total };
    }).filter((row) => row.value > 0 || !selectedMonth).sort((left, right) => right.value - left.value);
  })();

  const shown = categories.filter((row) => row.category !== "uncategorized");
  const selected = shown.find((row) => row.category === initialCategory) ?? shown[0];
  const categoryTotal = categories.reduce((sum, row) => sum + row.value, 0);
  const largest = Math.max(...shown.map((row) => row.value), 1);
  const totals = months.reduce(
    (sum, item) => ({ spend: sum.spend + item.spendMinor, income: sum.income + item.incomeMinor + item.refundsMinor, net: sum.net + item.netCashFlowMinor }),
    { spend: 0, income: 0, net: 0 },
  );
  const uncategorized = categories.find((row) => row.category === "uncategorized")?.value ?? 0;
  const selectedIndex = selectedMonth ? monthKeys.indexOf(selectedMonth) : undefined;
  const selectCategory = (category: MoneyCategory) =>
    void router.navigate({ to: "/money", search: { view: "spending", category }, replace: true, resetScroll: false });

  if (!observed.length) {
    return (
      <MoneyPanel>
        <EmptyState title="No spending history">Import a cash or card statement to see income, spending, and categories.</EmptyState>
      </MoneyPanel>
    );
  }
  const span = months.length ? `${formatMonth(months[0]!.month)} – ${formatMonth(months.at(-1)!.month)}` : "";
  return (
    <div className="money-stack">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {month ? <>Showing <strong className="font-semibold text-foreground">{formatMonth(month.month)}</strong></> : <>{span} · {months.length} complete months</>}
        </p>
        <div className="flex items-center gap-2">
          {month ? (
            <button type="button" className={buttonVariants({ variant: "secondary", size: "sm" })} onClick={() => setSelectedMonth(undefined)} aria-label={`Show all months instead of ${formatMonth(month.month)}`}>
              {formatMonth(month.month)} ×
            </button>
          ) : null}
          <Segmented label="Months shown" value={range} onValue={(value) => { setRange(value); setSelectedMonth(undefined); }} options={[["12", "12M"], ["24", "24M"], ["all", "All"]]} />
        </div>
      </div>

      <StatStrip label="Spending summary">
        {month ? (
          <>
            <Stat label="Spent" value={formatMinor(month.spendMinor)} detail={`Average ${formatMinor(totals.spend / Math.max(months.length, 1))}`} />
            <Stat label="Income" value={formatMinor(month.incomeMinor + month.refundsMinor)} detail={`Incl. ${formatMinor(month.refundsMinor)} refunds`} />
            <Stat label="Net flow" value={formatMinor(month.netCashFlowMinor, { signed: true })} tone={month.netCashFlowMinor} detail={month.incomeMinor ? `${formatRatio(month.netCashFlowMinor / month.incomeMinor)} saved` : "No income"} />
          </>
        ) : (
          <>
            <Stat label="Spent" value={formatMinor(totals.spend)} detail={`${formatMinor(totals.spend / Math.max(months.length, 1))} per month`} />
            <Stat label="Income" value={formatMinor(totals.income)} detail={`${formatMinor(totals.income / Math.max(months.length, 1))} per month`} />
            <Stat label="Net flow" value={formatMinor(totals.net, { signed: true })} tone={totals.net} detail={totals.income ? `${formatRatio(totals.net / totals.income)} saved` : "No income"} />
          </>
        )}
        <Stat
          label="Uncategorized"
          value={formatMinor(uncategorized)}
          detail={reviewCounts.uncategorized ? <Link to="/money" search={{ view: "review" }} className="text-warning hover:underline">Review {reviewCounts.uncategorized.toLocaleString("en-GB")} rows</Link> : "None"}
        />
      </StatStrip>

      <MoneyPanel
        title="Monthly cash flow"
        description={
          <>
            Select a month to filter the categories. Transfers between your accounts are left out.
            {transferReview.unresolvedNegativeCount + transferReview.unresolvedPositiveCount ? (
              <> <Link to="/money" search={{ view: "review" }} className="text-warning hover:underline">{(transferReview.unresolvedNegativeCount + transferReview.unresolvedPositiveCount).toLocaleString("en-GB")} transfers still need a treatment.</Link></>
            ) : null}
          </>
        }
        actions={
          <Legend>
            <LegendItem color={SERIES.income}>Income</LegendItem>
            <LegendItem color={SERIES.spending}>Spending</LegendItem>
            <LegendItem color={SERIES.net} shape="dot">Net</LegendItem>
          </Legend>
        }
      >
        <PanelBody>
          <FlowChart
            label={`Monthly income and spending with net flow, ${span}. Select a month to filter the categories.`}
            months={months.map((item) => ({ label: formatMonth(item.month).slice(0, 3), income: (item.incomeMinor + item.refundsMinor) / 100, spending: (item.spendMinor + item.feesMinor + item.taxesMinor) / 100, net: item.netCashFlowMinor / 100 }))}
            selected={selectedIndex}
            onSelect={(index) => setSelectedMonth((current) => (current === monthKeys[index] ? undefined : monthKeys[index]))}
            tooltip={(index) => ({ ...flowTooltip(months[index]!), hint: selectedMonth === monthKeys[index] ? "Select again to show all months" : "Select to filter the categories" })}
          />
        </PanelBody>
        <TableTwin label="View monthly cash flow as a table">
          <table className="money-table">
            <thead>
              <tr><th>Month</th><th className="num">Income</th><th className="num">Refunds</th><th className="num">Spending</th><th className="num">Fees and taxes</th><th className="num">Net flow</th></tr>
            </thead>
            <tbody>
              {[...months].reverse().map((item) => (
                <tr key={item.month}>
                  <td>{formatMonth(item.month)}</td>
                  <td className="num">{formatMinor(item.incomeMinor)}</td>
                  <td className="num">{formatMinor(item.refundsMinor)}</td>
                  <td className="num">{formatMinor(-item.spendMinor)}</td>
                  <td className="num">{formatMinor(-(item.feesMinor + item.taxesMinor))}</td>
                  <td className={`num ${toneClass(item.netCashFlowMinor)}`}>{formatMinor(item.netCashFlowMinor, { signed: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableTwin>
      </MoneyPanel>

      <div className="money-grid money-grid--split">
        <MoneyPanel title="Categories" description={month ? `${formatMonth(month.month)} against each category's average` : "Share of spending and the shape of each month"}>
          <div className="mt-2 overflow-x-auto">
            {shown.length ? (
              <table className="money-table" aria-label="Spending categories">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num">{month ? formatMonth(month.month, true) : "Total"}</th>
                    <th className="hide-sm">Share</th>
                    <th className="num hide-sm">{month ? "vs average" : "Per month"}</th>
                    <th className="num">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => {
                    const delta = row.value - row.average;
                    return (
                      <tr
                        key={row.category}
                        data-selectable
                        aria-selected={row.category === selected?.category}
                        tabIndex={0}
                        onClick={() => selectCategory(row.category)}
                        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectCategory(row.category); } }}
                      >
                        <td><CategoryValue category={row.category} /></td>
                        <td className="num">{formatMinor(row.value)}</td>
                        <td className="hide-sm w-[28%]">
                          <span className="flex items-center gap-2">
                            <ShareBar ratio={row.value / largest} className="flex-1" />
                            <span className="w-11 text-right text-xs text-muted-foreground tabular-nums">{formatRatio(categoryTotal ? row.value / categoryTotal : 0)}</span>
                          </span>
                        </td>
                        <td className={`num hide-sm ${month ? toneClass(-delta) : ""}`}>{month ? formatMinor(delta, { signed: true }) : formatMinor(row.average)}</td>
                        <td className="num"><SparkBars values={row.values.slice(-12)} highlight={selectedIndex === undefined ? undefined : selectedIndex - Math.max(0, row.values.length - 12)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState title="No categorized spending in this range" />
            )}
          </div>
        </MoneyPanel>
        {selected ? <CategoryDetail spending={spending} category={selected.category} values={selected.values} labels={monthKeys} average={selected.average} selectedMonth={selectedMonth} /> : <span />}
      </div>
    </div>
  );
}

function CategoryDetail({
  spending,
  category,
  values,
  labels,
  average,
  selectedMonth,
}: {
  spending: MoneyTrackerPageData["spending"];
  category: MoneyCategory;
  values: readonly number[];
  labels: readonly string[];
  average: number;
  selectedMonth?: string;
}) {
  const period = new Set(selectedMonth ? [selectedMonth] : labels);
  const merchants = [...spending.merchantMonths.filter((row) => row.category === category && period.has(row.month)).reduce((totals, row) => {
    const total = totals.get(row.description) ?? { amount: 0, count: 0 };
    totals.set(row.description, { amount: total.amount + row.amountMinor, count: total.count + row.count });
    return totals;
  }, new Map<string, { amount: number; count: number }>())].sort((left, right) => right[1].amount - left[1].amount).slice(0, 6);
  const topMerchant = merchants[0]?.[1].amount ?? 1;
  const recent = spending.categoryActivity.filter((row) => row.category === category && period.has(row.occurredAt.slice(0, 7))).slice(0, 5);
  const total = selectedMonth ? values[labels.indexOf(selectedMonth)] ?? 0 : values.reduce((sum, value) => sum + value, 0);
  return (
    <MoneyPanel
      title={moneyCategoryLabel(category)}
      description={selectedMonth ? `${formatMinor(total)} in ${formatMonth(selectedMonth)}` : `${formatMinor(total)} in ${labels.length} months · ${formatMinor(average)} per month`}
      actions={
        <Link to="/money" search={{ view: "transactions", category, fromMonth: selectedMonth ?? labels[0], toMonth: selectedMonth ?? labels.at(-1) }} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          Transactions
          <ChevronRight />
        </Link>
      }
    >
      <PanelBody className="grid gap-4">
        <MonthBars
          label={`${moneyCategoryLabel(category)} spending per month with the average as a dashed line`}
          values={values.map((value) => value / 100)}
          labels={labels.map((label) => formatMonth(label).slice(0, 3))}
          highlight={selectedMonth ? labels.indexOf(selectedMonth) : labels.length - 1}
          average={average / 100}
          tooltip={(index) => ({ title: formatMonth(labels[index]!), rows: [[moneyCategoryLabel(category), formatMinor(values[index] ?? 0), SERIES.primary], ["Average", formatMinor(average)]] })}
        />
        <section aria-label="Largest merchants">
          <h3 className="mb-2 text-xs text-muted-foreground">Largest merchants{selectedMonth ? `, ${formatMonth(selectedMonth)}` : ""}</h3>
          {merchants.length ? (
            <div className="grid gap-2">
              {merchants.map(([name, value]) => (
                <div key={name} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_5.5rem] items-center gap-3 text-sm">
                  <span className="truncate" title={name}>{name}</span>
                  <ShareBar ratio={value.amount / topMerchant} />
                  <span className="text-right tabular-nums">{formatMinor(value.amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No merchants in this period.</p>
          )}
        </section>
        {recent.length ? (
          <section aria-label="Latest transactions">
            <h3 className="mb-1 text-xs text-muted-foreground">Latest transactions</h3>
            <div className="divide-y">
              {recent.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                  <span className="min-w-0 truncate" title={row.description}>{row.description || row.sourceType}</span>
                  <span className="shrink-0 text-muted-foreground">{formatDay(row.occurredAt)}</span>
                  <span className="w-20 shrink-0 text-right tabular-nums">{formatMinor(Math.abs(row.amountMinor), { precise: true })}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </PanelBody>
    </MoneyPanel>
  );
}
