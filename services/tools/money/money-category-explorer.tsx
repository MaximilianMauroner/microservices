"use client";

import { useEffect, useMemo, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { MoneyCategory } from "./money-enums.js";
import type { MoneySpendingAnalytics } from "./money-repository.js";
import { Badge } from "../src/components/ui/badge.js";
import { Button } from "../src/components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../src/components/ui/card.js";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../src/components/ui/chart.js";

type CategoryPeriod = "6m" | "1y" | "all";
type CategoryTotal = Readonly<{ category: MoneyCategory; amountMinor: number; count: number }>;

const preciseCurrency = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const compactCurrency = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const trendConfig = { amount: { label: "Spend" } } satisfies ChartConfig;
const categoryColors = ["#67e8f9", "#c084fc", "#facc15", "#4ade80", "#60a5fa", "#fb7185", "#f472b6", "#fb923c", "#a3e635"];

export function MoneyCategoryExplorer({ spending, initialCategory }: { spending: MoneySpendingAnalytics; initialCategory?: MoneyCategory }) {
  const router = useRouter();
  const [period, setPeriod] = useState<CategoryPeriod>("1y");
  const availableMonths = useMemo(() => [...new Set(spending.categoryMonths.map((row) => row.month))].sort(), [spending.categoryMonths]);
  const selectedMonths = useMemo(() => period === "all" ? availableMonths : availableMonths.slice(period === "6m" ? -6 : -12), [availableMonths, period]);
  const selectedMonthSet = useMemo(() => new Set(selectedMonths), [selectedMonths]);
  const totals = useMemo(() => aggregateCategories(spending.categoryMonths.filter((row) => selectedMonthSet.has(row.month))), [selectedMonthSet, spending.categoryMonths]);
  const defaultCategory = initialCategory && totals.some((row) => row.category === initialCategory) ? initialCategory : totals[0]?.category;
  const [category, setCategory] = useState<MoneyCategory | undefined>(defaultCategory);
  useEffect(() => {
    if (initialCategory && totals.some((row) => row.category === initialCategory)) setCategory(initialCategory);
    else if (!category || !totals.some((row) => row.category === category)) setCategory(totals[0]?.category);
  }, [category, initialCategory, totals]);

  const selected = totals.find((row) => row.category === category);
  const totalSpend = totals.reduce((sum, row) => sum + row.amountMinor, 0);
  const uncategorizedRow = totals.find((row) => row.category === "uncategorized");
  const uncategorized = uncategorizedRow?.amountMinor ?? 0;
  const coverage = totalSpend ? (totalSpend - uncategorized) / totalSpend * 100 : 0;
  const trend = selectedMonths.map((month) => ({ month, amount: spending.categoryMonths.filter((row) => row.month === month && row.category === category).reduce((sum, row) => sum + row.amountMinor, 0) / 100 }));
  const merchants = aggregateMerchants(spending.merchantMonths.filter((row) => selectedMonthSet.has(row.month) && row.category === category));
  const activity = spending.categoryActivity.filter((row) => row.category === category && selectedMonthSet.has(row.occurredAt.slice(0, 7)));
  const selectCategory = (nextCategory: MoneyCategory) => {
    setCategory(nextCategory);
    void router.navigate({ to: "/money", search: { view: "categories", category: nextCategory }, replace: true });
  };

  return <div className="money-category-explorer space-y-3">
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Category summary">
      <Metric label="Selected-period spend" value={formatMinor(totalSpend)} detail={`${selectedMonths.length} completed months`} />
      <Metric label="Category coverage" value={`${coverage.toFixed(1)}%`} detail={`${(uncategorizedRow?.count ?? 0).toLocaleString("en-GB")} transactions · ${formatMinor(uncategorized)} uncategorized`} />
      <Metric label="Monthly average" value={formatMinor(selectedMonths.length ? Math.round(totalSpend / selectedMonths.length) : 0)} detail="completed months only" />
      <Metric label="Active categories" value={totals.length.toLocaleString("en-GB")} detail={`${totals.reduce((sum, row) => sum + row.count, 0).toLocaleString("en-GB")} transactions`} />
    </section>

    <section className="grid items-start gap-3 xl:grid-cols-[minmax(19rem,.72fr)_minmax(0,1.28fr)]">
      <Card>
        <CardHeader className="border-b"><div className="flex items-start justify-between gap-3"><div><CardTitle>Category map</CardTitle><CardDescription>Click a bar to inspect its trend, merchants, and transactions</CardDescription></div><CategoryPeriodSelector period={period} onPeriod={setPeriod} /></div></CardHeader>
        <CardContent className="p-0">
          {totals.length ? <div className="money-category-map" role="list" aria-label="Spending categories">{totals.map((row, index) => <div role="listitem" key={row.category}><CategoryBar row={row} total={totalSpend} maximum={totals[0]?.amountMinor ?? 1} color={categoryColors[index % categoryColors.length]!} active={row.category === category} onSelect={() => selectCategory(row.category)} /></div>)}</div> : <EmptyState />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b"><div className="flex items-start justify-between gap-3"><div><CardTitle>{selected ? categoryLabel(selected.category) : "Category detail"}</CardTitle><CardDescription>{selected ? `${formatMinor(selected.amountMinor)} across ${selected.count.toLocaleString("en-GB")} transactions` : "Select a category from the map"}</CardDescription></div>{selected ? <Badge variant="outline">{totalSpend ? (selected.amountMinor / totalSpend * 100).toFixed(1) : "0.0"}%</Badge> : null}</div></CardHeader>
        <CardContent className="space-y-5 pt-5">
          {selected ? <>
            <MountedChart fallback={<div className="money-chart-fallback">Loading trend</div>}>
              <ChartContainer config={trendConfig} className="h-64 w-full aspect-auto" initialDimension={{ width: 760, height: 256 }} role="img" aria-label={`${categoryLabel(selected.category)} monthly spending trend. Exact values follow in a table.`}>
                <AreaChart data={trend} margin={{ left: 4, right: 12, top: 8 }}><defs><linearGradient id="category-spend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#67e8f9" stopOpacity={0.34} /><stop offset="95%" stopColor="#67e8f9" stopOpacity={0.03} /></linearGradient></defs><CartesianGrid vertical={false} /><XAxis dataKey="month" tickLine={false} axisLine={false} minTickGap={24} /><YAxis tickLine={false} axisLine={false} width={68} tickFormatter={(value: number) => compactCurrency.format(value)} /><ChartTooltip content={<ChartTooltipContent />} /><Area dataKey="amount" name="Spend" type="monotone" fill="url(#category-spend-fill)" stroke="#67e8f9" strokeWidth={2} /></AreaChart>
              </ChartContainer>
            </MountedChart>
            <details className="money-chart-data"><summary>View exact graph data</summary><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th className="text-left">Month</th><th className="text-right">Spend</th></tr></thead><tbody>{trend.map((row) => <tr key={row.month}><td>{row.month}</td><td className="text-right font-mono">{preciseCurrency.format(row.amount)}</td></tr>)}</tbody></table></div></details>
          </> : <EmptyState />}
        </CardContent>
      </Card>
    </section>

    <section className="grid items-start gap-3 lg:grid-cols-2">
      <Card><CardHeader className="border-b"><CardTitle>Merchant groups</CardTitle><CardDescription>Largest descriptions inside {selected ? categoryLabel(selected.category) : "the selected category"}</CardDescription></CardHeader><CardContent className="divide-y p-0">{merchants.slice(0, 10).map((merchant) => <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 text-sm" key={merchant.description}><div className="min-w-0"><p className="truncate font-medium">{merchant.description}</p><p className="text-xs text-muted-foreground">{merchant.count.toLocaleString("en-GB")} transactions</p></div><span className="font-mono">{formatMinor(merchant.amountMinor)}</span></div>)}{merchants.length === 0 ? <EmptyState /> : null}</CardContent></Card>
      <Card><CardHeader className="border-b"><div className="flex items-start justify-between gap-3"><div><CardTitle>Recent transactions</CardTitle><CardDescription>Latest ledger rows in this category and selected period</CardDescription></div><Link to="/money" search={{ view: "transactions" }} className="money-inline-link">Open ledger</Link></div></CardHeader><CardContent className="p-0">{activity.length ? <><div className="divide-y md:hidden" role="list">{activity.map((row) => <article className="flex min-h-16 items-center justify-between gap-3 px-4 py-3" key={row.id} role="listitem"><div className="min-w-0"><h3 className="truncate text-sm font-medium">{row.description || row.sourceType}</h3><p className="mt-1 text-xs text-muted-foreground">{row.occurredAt.slice(0, 10)} · {row.categoryOrigin}</p></div><strong className="shrink-0 font-mono text-sm text-rose-300">{formatMinor(Math.abs(row.amountMinor))}</strong></article>)}</div><div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[34rem] text-sm"><thead className="border-b text-xs text-muted-foreground"><tr><th className="px-4 py-3 text-left">Date</th><th className="px-4 py-3 text-left">Description</th><th className="px-4 py-3 text-left">Origin</th><th className="px-4 py-3 text-right">Amount</th></tr></thead><tbody className="divide-y">{activity.map((row) => <tr key={row.id}><td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{row.occurredAt.slice(0, 10)}</td><td className="max-w-64 truncate px-4 py-3 font-medium">{row.description || row.sourceType}</td><td className="px-4 py-3"><Badge variant="outline">{row.categoryOrigin}</Badge></td><td className="px-4 py-3 text-right font-mono text-rose-300">{formatMinor(Math.abs(row.amountMinor))}</td></tr>)}</tbody></table></div></> : <EmptyState />}</CardContent></Card>
    </section>
  </div>;
}

export function MoneyCategoryOverview({ spending }: { spending: MoneySpendingAnalytics }) {
  const rows = spending.categories.slice(0, 6);
  const total = spending.categories.reduce((sum, row) => sum + row.amountMinor, 0);
  const maximum = rows[0]?.amountMinor ?? 1;
  return <Card><CardHeader className="border-b"><div className="flex items-start justify-between gap-3"><div><CardTitle>Spending categories</CardTitle><CardDescription>All imported completed spending</CardDescription></div><Link to="/money" search={{ view: "categories" }} className="money-inline-link">Explore</Link></div></CardHeader><CardContent className="p-0"><div className="money-category-map money-category-map--compact">{rows.map((row, index) => <CategoryBar key={row.category} row={row} total={total} maximum={maximum} color={categoryColors[index % categoryColors.length]!} active={false} href />)}</div>{rows.length === 0 ? <EmptyState /> : null}</CardContent></Card>;
}

function CategoryBar({ row, total, maximum, color, active, onSelect, href = false }: { row: CategoryTotal; total: number; maximum: number; color: string; active: boolean; onSelect?: () => void; href?: boolean }) {
  const contents = <><span className="money-category-bar__meta"><strong>{categoryLabel(row.category)}</strong><span>{formatMinor(row.amountMinor)} · {total ? (row.amountMinor / total * 100).toFixed(1) : "0.0"}%</span></span><span className="money-category-bar__track"><span style={{ width: `${Math.max(row.amountMinor / maximum * 100, 1)}%`, backgroundColor: color }} /></span><span className="sr-only">{row.count} transactions</span></>;
  return href ? <Link to="/money" search={{ view: "categories", category: row.category }} className="money-category-bar" aria-label={`Explore ${categoryLabel(row.category)}`}>{contents}</Link> : <button type="button" className="money-category-bar" data-active={active || undefined} aria-pressed={active} onClick={onSelect}>{contents}</button>;
}

function CategoryPeriodSelector({ period, onPeriod }: { period: CategoryPeriod; onPeriod: (period: CategoryPeriod) => void }) {
  return <div role="group" aria-label="Category period" className="flex gap-1"><PeriodButton active={period === "6m"} onClick={() => onPeriod("6m")}>6M</PeriodButton><PeriodButton active={period === "1y"} onClick={() => onPeriod("1y")}>1Y</PeriodButton><PeriodButton active={period === "all"} onClick={() => onPeriod("all")}>All</PeriodButton></div>;
}

function PeriodButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <Button type="button" size="sm" variant={active ? "default" : "outline"} aria-pressed={active} onClick={onClick}>{children}</Button>; }
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>; }
function EmptyState() { return <div className="p-8 text-center text-sm text-muted-foreground">No completed spending in this period.</div>; }
function MountedChart({ fallback, children }: { fallback: React.ReactNode; children: React.ReactNode }) { const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), []); return mounted ? children : fallback; }
function formatMinor(value: number) { return preciseCurrency.format(value / 100); }
function categoryLabel(category: MoneyCategory) { return category.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }

function aggregateCategories(rows: MoneySpendingAnalytics["categoryMonths"]): CategoryTotal[] {
  const totals = new Map<MoneyCategory, { amountMinor: number; count: number }>();
  for (const row of rows) { const total = totals.get(row.category) ?? { amountMinor: 0, count: 0 }; total.amountMinor += row.amountMinor; total.count += row.count; totals.set(row.category, total); }
  return [...totals].map(([category, total]) => ({ category, ...total })).sort((left, right) => right.amountMinor - left.amountMinor);
}

function aggregateMerchants(rows: MoneySpendingAnalytics["merchantMonths"]) {
  const totals = new Map<string, { amountMinor: number; count: number }>();
  for (const row of rows) { const total = totals.get(row.description) ?? { amountMinor: 0, count: 0 }; total.amountMinor += row.amountMinor; total.count += row.count; totals.set(row.description, total); }
  return [...totals].map(([description, total]) => ({ description, ...total })).sort((left, right) => right.amountMinor - left.amountMinor);
}
