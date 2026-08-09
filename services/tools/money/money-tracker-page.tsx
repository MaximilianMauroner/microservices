"use client";

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, XAxis, YAxis } from "recharts";
import type { MoneyTrackerPageData } from "../src/protected-data.js";
import { moneyTrackerAccountCategory, moneyTrackerTrendStats, type MoneyTrackerAccountCategory, type MoneyTrackerTrendStats } from "./money-tracker-domain.js";
import { AppShell } from "../src/components/app-shell.js";
import { Alert, AlertDescription, AlertTitle } from "../src/components/ui/alert.js";
import { Badge } from "../src/components/ui/badge.js";
import { Button } from "../src/components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../src/components/ui/card.js";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../src/components/ui/chart.js";
import { AllocationTreemap } from "./allocation-treemap.js";
import { MoneyActivityView, MoneyBalanceEntry, MoneyImportsView, MoneyInvestmentsView, MoneyPlanningCard, MoneySpendingView } from "./money-ledger-views.js";

export type MoneyTrackerView = "overview" | "activity" | "spending" | "investments" | "balances" | "imports";
type Period = "6m" | "1y" | "all";
type Month = MoneyTrackerPageData["months"][number];
type GroupedMonth = Month & { money: number; stocks: number; trend: number };

const currency = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const preciseCurrency = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const colors = ["#67e8f9", "#c084fc", "#facc15", "#4ade80", "#60a5fa", "#fb7185", "#f472b6"];
// Colors are passed directly to Recharts. ChartConfig colors generate an inline
// style element, which the platform's nonce-only CSP intentionally blocks.
const totalConfig = { money: { label: "Cash" }, stocks: { label: "Stocks" }, trend: { label: "Total trend" } } satisfies ChartConfig;
const changeConfig = { change: { label: "Balance change" } } satisfies ChartConfig;

export function MoneyTrackerPage(props: MoneyTrackerPageData & { view: MoneyTrackerView }) {
  const [period, setPeriod] = useState<Period>("1y");
  const allMonths = useMemo(() => props.months.map((month) => groupMonth(month, props.accountLabels)), [props.accountLabels, props.months]);
  const months = useMemo(() => withLinearTrend(period === "all" ? allMonths : allMonths.slice(period === "6m" ? -6 : -12)), [allMonths, period]);
  const latest = months.at(-1);
  const previous = months.at(-2);
  const monthlyChange = latest && previous ? latest.total - previous.total : undefined;
  const trends = useMemo(() => moneyTrackerTrendStats(months, allMonths), [allMonths, months]);
  const showPeriod = props.view === "overview" || props.view === "balances";

  return <><AppShell product="Money" showSignOut /><main id="main" className="app-page space-y-4">
    <header className="app-heading mb-0">
      <div><p className="eyebrow">Money</p><h1>{viewTitle(props.view)}</h1><p>{viewDescription(props.view)}</p></div>
      <div className="app-heading__actions">{showPeriod ? <><PeriodButton active={period === "6m"} onClick={() => setPeriod("6m")}>6M</PeriodButton><PeriodButton active={period === "1y"} onClick={() => setPeriod("1y")}>1Y</PeriodButton><PeriodButton active={period === "all"} onClick={() => setPeriod("all")}>All</PeriodButton></> : null}<Badge variant="outline">Private</Badge><Badge variant="outline">{props.actor}</Badge></div>
    </header>
    <MoneyNav view={props.view} />
    {props.view === "overview" ? <Overview {...props} months={months} latest={latest} previous={previous} monthlyChange={monthlyChange} trends={trends} /> : null}
    {props.view === "activity" ? <MoneyActivityView activity={props.activity} transactionCount={props.transactionCount} transferReview={props.transferReview} /> : null}
    {props.view === "spending" ? <MoneySpendingView spending={props.spending} /> : null}
    {props.view === "investments" ? <MoneyInvestmentsView investments={props.investments} /> : null}
    {props.view === "balances" ? <><MoneyBalanceEntry /><Accounts accounts={props.accounts} accountLabels={props.accountLabels} months={months} latest={latest} previous={previous} /><History accounts={props.accounts} accountLabels={props.accountLabels} months={months} /></> : null}
    {props.view === "imports" ? <MoneyImportsView imports={props.imports} /> : null}
  </main></>;
}

export function MoneyTrackerPendingPage({ view }: { view: MoneyTrackerView }) {
  return <><AppShell product="Money" showSignOut /><main id="main" className="app-page space-y-4" aria-busy="true">
    <header className="app-heading mb-0">
      <div><p className="eyebrow">Money</p><h1>{viewTitle(view)}</h1><p>Loading private financial data.</p></div>
      <Badge variant="outline">Private</Badge>
    </header>
    <MoneyNav view={view} />
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading summary">
      {Array.from({ length: 4 }, (_, index) => <Card key={index}><CardContent className="space-y-3 p-4"><LoadingBlock className="h-3 w-24" /><LoadingBlock className="h-7 w-32" /><LoadingBlock className="h-3 w-20" /></CardContent></Card>)}
    </section>
    <section className="grid gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,.7fr)]" aria-label="Loading dashboard">
      <Card><CardHeader className="border-b"><LoadingBlock className="h-4 w-40" /><LoadingBlock className="h-3 w-64 max-w-full" /></CardHeader><CardContent className="pt-5"><LoadingBlock className="h-[19rem] w-full" /></CardContent></Card>
      <Card><CardHeader className="border-b"><LoadingBlock className="h-4 w-40" /><LoadingBlock className="h-3 w-48 max-w-full" /></CardHeader><CardContent className="space-y-3 pt-5">{Array.from({ length: 5 }, (_, index) => <LoadingBlock key={index} className="h-10 w-full" />)}</CardContent></Card>
    </section>
  </main></>;
}

function Overview({ accounts, accountLabels, planning, months, latest, previous, monthlyChange, trends }: MoneyTrackerPageData & { months: GroupedMonth[]; latest?: GroupedMonth; previous?: GroupedMonth; monthlyChange?: number; trends: MoneyTrackerTrendStats }) {
  const changes = withChanges(months);
  const contributors = accountRows(accounts, accountLabels, latest, previous).sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0));
  const maxChange = Math.max(...contributors.map((item) => Math.abs(item.change ?? 0)), 1);
  const composition = accountRows(accounts, accountLabels, latest).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const topTwoShare = latest?.total ? composition.slice(0, 2).reduce((sum, item) => sum + (item.value ?? 0), 0) / latest.total * 100 : undefined;
  const allocationShift = trends.allocation?.previousYear ? trends.allocation.current.money - trends.allocation.previousYear.money : undefined;
  return <>
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" aria-label="Balance summary"><Metric label="Net worth" value={latest ? currency.format(latest.total) : "No data"} detail={formatTrendPercent(trends.yearOverYear?.total.percent)} tone={tone(trends.yearOverYear?.total.change)} /><Metric label="Liquid cash" value={latest ? currency.format(latest.money) : "No data"} detail={`${formatSigned(trends.yearOverYear?.money.change)} YoY`} tone={tone(trends.yearOverYear?.money.change)} /><Metric label="Invested assets" value={latest ? currency.format(latest.stocks) : "No data"} detail={`${formatSigned(trends.yearOverYear?.stocks.change)} YoY`} tone={tone(trends.yearOverYear?.stocks.change)} /><Metric label="Current drawdown" value={formatTrendPercent(trends.drawdown?.percent)} detail={formatSigned(trends.drawdown?.change)} tone={tone(trends.drawdown?.change)} /><Metric label="3m momentum" value={formatTrendPercent(trends.momentum?.percent)} detail={formatSigned(trends.momentum?.change)} tone={tone(trends.momentum?.change)} /><Metric label="Cash allocation" value={trends.allocation ? `${trends.allocation.current.money.toFixed(1)}%` : "—"} detail={allocationShift === undefined ? undefined : `${formatPoints(allocationShift)} YoY`} /></section>
    <MoneyPlanningCard planning={planning} />
    <section className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.75fr)_minmax(18rem,.75fr)]">
      <ChartCard title="Cash and stocks" description="Independent balances with a full-range total trend"><MountedChart fallback={<ChartFallback values={months.map((month) => month.total)} />}><ChartContainer config={totalConfig} className="h-[23rem] w-full aspect-auto" initialDimension={{ width: 760, height: 368 }}><ComposedChart data={months} margin={{ left: 4, right: 12, top: 8 }}><defs><linearGradient id="money-balance-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={colors[0]} stopOpacity={0.34} /><stop offset="95%" stopColor={colors[0]} stopOpacity={0.04} /></linearGradient><linearGradient id="stock-balance-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={colors[1]} stopOpacity={0.34} /><stop offset="95%" stopColor={colors[1]} stopOpacity={0.04} /></linearGradient></defs><CartesianGrid vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} minTickGap={28} /><YAxis tickLine={false} axisLine={false} width={72} tickFormatter={(value: number) => currency.format(value)} /><ChartTooltip content={<ChartTooltipContent />} /><Area dataKey="stocks" name="Stocks" type="monotone" fill="url(#stock-balance-fill)" stroke={colors[1]} strokeWidth={2} /><Area dataKey="money" name="Cash" type="monotone" fill="url(#money-balance-fill)" stroke={colors[0]} strokeWidth={2} /><Line dataKey="trend" name="Total trend" type="linear" stroke="#fafafa" strokeWidth={2} strokeDasharray="7 6" dot={false} /></ComposedChart></ChartContainer></MountedChart></ChartCard>
      <Card><CardHeader className="border-b"><CardTitle>Composition and concentration</CardTitle><CardDescription>{latest?.date ?? "No snapshot available"}</CardDescription></CardHeader><CardContent className="p-0"><div className="space-y-2 border-b px-4 py-4"><div className="flex justify-between text-xs"><span className="text-cyan-300">Cash {latest?.total ? `${(latest.money / latest.total * 100).toFixed(1)}%` : "—"}</span><span className="text-purple-300">Stocks {latest?.total ? `${(latest.stocks / latest.total * 100).toFixed(1)}%` : "—"}</span></div><div className="flex h-2 overflow-hidden rounded-full bg-muted"><div className="bg-cyan-300" style={{ width: `${latest?.total ? latest.money / latest.total * 100 : 0}%` }} /><div className="bg-purple-400" style={{ width: `${latest?.total ? latest.stocks / latest.total * 100 : 0}%` }} /></div><div className="divide-y">{composition.slice(0, 4).map((item) => <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-2.5 text-sm" key={item.account}><div className="min-w-0"><p className="truncate font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{moneyTrackerAccountCategory(item.label) === "stocks" ? "Stocks" : "Cash"}</p></div><div className="text-right font-mono"><p>{preciseCurrency.format(item.value ?? 0)}</p><p className="text-xs text-muted-foreground">{latest?.total ? `${((item.value ?? 0) / latest.total * 100).toFixed(1)}%` : "—"}</p></div></div>)}</div></div><div className="px-4 py-3 text-xs text-muted-foreground">{topTwoShare === undefined ? "No concentration data." : `The two largest accounts hold ${topTwoShare.toFixed(1)}% of the current total.`}</div></CardContent></Card>
    </section>
    <section className="grid gap-3 lg:grid-cols-2">
      <ChartCard title="Monthly balance change" description="Absolute month-over-month movement"><MountedChart fallback={<ChartFallback values={changes.map((month) => month.change)} />}><ChartContainer config={changeConfig} className="h-64 w-full aspect-auto"><BarChart data={changes}><CartesianGrid vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} /><YAxis tickLine={false} axisLine={false} width={68} tickFormatter={(value: number) => currency.format(value)} /><ChartTooltip content={<ChartTooltipContent formatter={(value) => <TooltipValue label="Change" value={formatSigned(Number(value))} />} />} /><Bar dataKey="change" radius={3}>{changes.map((month) => <Cell key={month.date} fill={month.change < 0 ? "#fb7185" : "#4ade80"} />)}</Bar></BarChart></ChartContainer></MountedChart></ChartCard>
      <Card><CardHeader className="border-b"><CardTitle>What moved this month</CardTitle><CardDescription>{formatSigned(monthlyChange)} across the latest snapshot</CardDescription></CardHeader><CardContent className="p-0">{(["stocks", "money"] as const).map((category) => { const items = contributors.filter((item) => moneyTrackerAccountCategory(item.label) === category); const subtotal = items.reduce((sum, item) => sum + (item.change ?? 0), 0); return <section key={category} className="border-b last:border-b-0"><div className="flex items-center justify-between bg-muted/40 px-4 py-2.5"><span className="text-[.68rem] font-semibold uppercase tracking-[.08em] text-muted-foreground">{category === "stocks" ? "Stocks" : "Cash"}</span><span className={`font-mono text-xs ${changeClass(subtotal)}`}>{formatSigned(subtotal, true)}</span></div><div className="divide-y">{items.map((item) => <div className="grid grid-cols-[minmax(7rem,1fr)_minmax(6rem,1.4fr)_auto] items-center gap-3 px-4 py-3 text-sm" key={item.account}><span className="truncate font-medium">{item.label}</span><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${item.change !== undefined && item.change < 0 ? "bg-rose-400" : "bg-emerald-400"}`} style={{ width: `${Math.abs(item.change ?? 0) / maxChange * 100}%` }} /></div><span className={changeClass(item.change)}>{formatSigned(item.change, true)}</span></div>)}</div></section>; })}</CardContent></Card>
    </section>
    <section className="grid items-start gap-3 lg:grid-cols-3" aria-label="Trend statistics">
      <Card><CardHeader className="border-b"><CardTitle>Year-over-year</CardTitle><CardDescription>{trends.yearOverYear ? `Compared with ${trends.yearOverYear.comparisonDate}` : "A matching prior-year month is required"}</CardDescription></CardHeader><CardContent className="divide-y p-0"><TrendRow label="Total" change={trends.yearOverYear?.total} /><TrendRow label="Cash" change={trends.yearOverYear?.money} /><TrendRow label="Stocks" change={trends.yearOverYear?.stocks} /></CardContent></Card>
      <Card><CardHeader className="border-b"><CardTitle>Selected-range trend</CardTitle><CardDescription>Calculated from the visible snapshots</CardDescription></CardHeader><CardContent className="divide-y p-0"><TrendRow label="Cumulative change" change={trends.periodChange} /><StatRow label="Geometric monthly change" value={formatTrendPercent(trends.geometricAverageMonthlyPercent)} /><StatRow label="Average total change" value={formatSigned(trends.averageMonthlyChange, true)} /><StatRow label="Average cash change" value={formatSigned(trends.averageMoneyChange, true)} /><StatRow label="Average stock change" value={formatSigned(trends.averageStocksChange, true)} /><StatRow label="High-water mark" value={trends.highWaterMark ? preciseCurrency.format(trends.highWaterMark.value) : "—"} detail={trends.highWaterMark?.date} /></CardContent></Card>
      <Card><CardHeader className="border-b"><CardTitle>Annual change and allocation</CardTitle><CardDescription>Each year starts from the prior year-end when available</CardDescription></CardHeader><CardContent className="divide-y p-0">{trends.yearlyChanges.map((item) => <TrendRow key={item.year} label={String(item.year)} change={item} />)}{trends.allocation?.previousYear ? <AllocationRow label={trends.allocation.previousYear.date} money={trends.allocation.previousYear.money} stocks={trends.allocation.previousYear.stocks} /> : null}{trends.allocation ? <AllocationRow label="Current" money={trends.allocation.current.money} stocks={trends.allocation.current.stocks} /> : null}<div className="px-4 py-3 text-xs text-muted-foreground">Balance movement includes transfers, deposits, withdrawals, and market changes. It is not an investment-return calculation.</div></CardContent></Card>
    </section>
  </>;
}

function Accounts({ accounts, accountLabels, months, latest, previous }: { accounts: string[]; accountLabels: Record<string, string>; months: GroupedMonth[]; latest?: GroupedMonth; previous?: GroupedMonth }) {
  const first = months.at(0);
  const cashAccounts = accounts.filter((account) => moneyTrackerAccountCategory(accountLabels[account] ?? account) === "money");
  const stockAccounts = accounts.filter((account) => moneyTrackerAccountCategory(accountLabels[account] ?? account) === "stocks");
  const rows = accountRows(accounts, accountLabels, latest, previous).map((row) => {
    const firstValue = first?.values[row.account];
    return { ...row, firstValue, periodChange: row.value !== undefined && firstValue !== undefined ? row.value - firstValue : undefined };
  }).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const topTwoShare = latest?.total ? rows.slice(0, 2).reduce((sum, row) => sum + (row.value ?? 0), 0) / latest.total * 100 : undefined;
  const allocationAccounts = rows.flatMap((row) => row.value === undefined ? [] : [{ name: row.label, value: row.value, category: moneyTrackerAccountCategory(row.label) }]);
  return <>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Account summary"><Metric label="Total balance" value={latest ? currency.format(latest.total) : "No data"} /><Metric label="Largest account" value={rows[0] ? currency.format(rows[0].value ?? 0) : "—"} detail={rows[0]?.label} /><Metric label="Top-two concentration" value={topTwoShare === undefined ? "—" : `${topTwoShare.toFixed(1)}%`} detail="of total balance" /><Metric label="Accounts recorded" value={latest ? `${Object.keys(latest.values).length} / ${accounts.length}` : "0 / 0"} detail="latest snapshot" /></section>
    <Card><CardHeader className="border-b"><CardTitle>Account map</CardTitle><CardDescription>{latest ? `${latest.date} · Area represents share of total balance` : "No snapshot available"}</CardDescription></CardHeader><CardContent className="p-4"><AllocationTreemap accounts={allocationAccounts} /></CardContent></Card>
    <section className="grid gap-3 lg:grid-cols-2" aria-label="Category balance history">
      <AccountGroupChart title="Cash history" category="money" accounts={cashAccounts} accountLabels={accountLabels} months={months} first={first} latest={latest} />
      <AccountGroupChart title="Stocks history" category="stocks" accounts={stockAccounts} accountLabels={accountLabels} months={months} first={first} latest={latest} />
    </section>
    <Card><CardHeader className="border-b"><CardTitle>Account detail</CardTitle><CardDescription>Latest movement, selected-period change, share, and observed range</CardDescription></CardHeader><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[64rem] text-sm"><thead className="border-b text-xs text-muted-foreground"><tr><th className="px-4 py-3 text-left">Account</th><th className="px-4 py-3 text-left">Category</th><th className="px-4 py-3 text-right">Balance</th><th className="px-4 py-3 text-right">Latest</th><th className="px-4 py-3 text-right">Latest %</th><th className="px-4 py-3 text-right">Selected period</th><th className="px-4 py-3 text-right">Period %</th><th className="px-4 py-3 text-right">Share</th><th className="px-4 py-3 text-right">Observed range</th></tr></thead><tbody className="divide-y">{rows.map((row) => <tr key={row.account}><td className="px-4 py-3 font-medium">{row.label}</td><td className="px-4 py-3"><Badge variant="outline">{moneyTrackerAccountCategory(row.label) === "money" ? "Cash" : "Stocks"}</Badge></td><td className="px-4 py-3 text-right font-mono">{preciseCurrency.format(row.value ?? 0)}</td><td className={`px-4 py-3 text-right font-mono ${changeClass(row.change)}`}>{formatSigned(row.change, true)}</td><td className={`px-4 py-3 text-right font-mono ${changeClass(row.change)}`}>{formatPercent(row.change, row.previous)}</td><td className={`px-4 py-3 text-right font-mono ${changeClass(row.periodChange)}`}>{formatSigned(row.periodChange, true)}</td><td className={`px-4 py-3 text-right font-mono ${changeClass(row.periodChange)}`}>{formatPercent(row.periodChange, row.firstValue)}</td><td className="px-4 py-3 text-right font-mono">{latest?.total ? `${((row.value ?? 0) / latest.total * 100).toFixed(1)}%` : "—"}</td><td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">{rangeForAccount(months, row.account)}</td></tr>)}</tbody></table></CardContent></Card>
  </>;
}

function AccountGroupChart({ title, category, accounts, accountLabels, months, first, latest }: { title: string; category: MoneyTrackerAccountCategory; accounts: string[]; accountLabels: Record<string, string>; months: GroupedMonth[]; first?: GroupedMonth; latest?: GroupedMonth }) {
  const dataKey = category === "money" ? "money" : "stocks";
  const label = category === "money" ? "Cash" : "Stocks";
  const palette = category === "money" ? ["#67e8f9", "#60a5fa", "#34d399", "#facc15", "#fb923c"] : ["#c084fc", "#f472b6", "#a78bfa"];
  const config = { ...Object.fromEntries(accounts.map((account) => [account, { label: accountLabels[account] ?? account }])), [dataKey]: { label: `${label} total` } } satisfies ChartConfig;
  const startValue = first?.[dataKey];
  const latestValue = latest?.[dataKey];
  const periodChange = startValue !== undefined && latestValue !== undefined ? latestValue - startValue : undefined;
  return <ChartCard title={title} description={`${latestValue === undefined ? "No data" : preciseCurrency.format(latestValue)} now · ${formatSigned(periodChange, true)} in the selected period`}><MountedChart fallback={<ChartFallback values={months.map((month) => month[dataKey])} />}><ChartContainer config={config} className="h-72 w-full aspect-auto"><ComposedChart data={months}><CartesianGrid vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} /><YAxis tickLine={false} axisLine={false} width={68} tickFormatter={(value: number) => currency.format(value)} /><ChartTooltip content={<ChartTooltipContent />} />{accounts.map((account, index) => <Area key={account} dataKey={`values.${account}`} name={account} type="monotone" stackId={dataKey} fill={palette[index % palette.length]} fillOpacity={0.62} stroke={palette[index % palette.length]} strokeWidth={1.5} />)}<Line dataKey={dataKey} name={`${label} total`} type="monotone" stroke="#fafafa" strokeWidth={2} dot={false} /></ComposedChart></ChartContainer></MountedChart></ChartCard>;
}

function History({ accounts, accountLabels, months }: { accounts: string[]; accountLabels: Record<string, string>; months: GroupedMonth[] }) {
  const descending = [...months].reverse();
  const changes = withChanges(months);
  const latest = months.at(-1);
  const previous = months.at(-2);
  const latestChange = latest && previous ? latest.total - previous.total : undefined;
  const complete = months.filter((month) => Object.keys(month.values).length === accounts.length).length;
  const largestIncrease = changes.length ? changes.reduce((best, item) => item.change > best.change ? item : best) : undefined;
  const largestDecrease = changes.length ? changes.reduce((best, item) => item.change < best.change ? item : best) : undefined;
  const high = months.length ? months.reduce((best, item) => item.total > best.total ? item : best) : undefined;
  const low = months.length ? months.reduce((best, item) => item.total < best.total ? item : best) : undefined;
  return <>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="History summary"><Metric label="Snapshots shown" value={String(months.length)} detail={months.length ? `${months[0]!.date} to ${months.at(-1)!.date}` : undefined} /><Metric label="Current total" value={latest ? currency.format(latest.total) : "No data"} detail={latest?.date} /><Metric label="Latest change" value={formatSigned(latestChange)} detail={latest && previous ? `${previous.date} to ${latest.date}` : undefined} tone={tone(latestChange)} /><Metric label="Complete snapshots" value={`${complete} / ${months.length}`} detail="all observed accounts" /></section>
    <Card><CardHeader className="border-b"><CardTitle>Monthly snapshot ledger</CardTitle><CardDescription>Newest first, including every account balance. Historical entries remain read-only.</CardDescription></CardHeader><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-max text-sm"><thead className="border-b text-xs text-muted-foreground"><tr><th className="sticky left-0 bg-card px-4 py-3 text-left">Date</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Change</th><th className="px-4 py-3 text-right">Cash</th><th className="px-4 py-3 text-right">Stocks</th>{accounts.map((account) => <th className="px-4 py-3 text-right" key={account}>{account}</th>)}<th className="px-4 py-3 text-right">Status</th></tr></thead><tbody className="divide-y">{descending.map((month, index) => { const older = descending[index + 1]; const change = older ? month.total - older.total : undefined; return <tr key={month.date}><td className="sticky left-0 bg-card px-4 py-3 font-medium">{month.date}</td><td className="px-4 py-3 text-right font-mono font-medium">{preciseCurrency.format(month.total)}</td><td className={`px-4 py-3 text-right font-mono ${changeClass(change)}`}>{formatSigned(change, true)}</td><td className="px-4 py-3 text-right font-mono">{preciseCurrency.format(month.money)}</td><td className="px-4 py-3 text-right font-mono">{preciseCurrency.format(month.stocks)}</td>{accounts.map((account) => <td className="px-4 py-3 text-right font-mono" key={account}>{month.values[account] === undefined ? <span className="text-muted-foreground">—</span> : preciseCurrency.format(month.values[account])}</td>)}<td className="px-4 py-3 text-right"><Badge variant={Object.keys(month.values).length === accounts.length ? "outline" : "destructive"}>{Object.keys(month.values).length === accounts.length ? "Complete" : "Incomplete"}</Badge></td></tr>; })}</tbody></table></CardContent></Card>
    <section className="grid items-start gap-3 lg:grid-cols-2">
      <Card><CardHeader className="border-b"><CardTitle>Selected-period extremes</CardTitle><CardDescription>Largest balance movements and observed range</CardDescription></CardHeader><CardContent className="divide-y p-0"><StatRow label="Largest increase" value={formatSigned(largestIncrease?.change, true)} detail={largestIncrease?.date} /><StatRow label="Largest decrease" value={formatSigned(largestDecrease?.change, true)} detail={largestDecrease?.date} /><StatRow label="Highest balance" value={high ? preciseCurrency.format(high.total) : "—"} detail={high?.date} /><StatRow label="Lowest balance" value={low ? preciseCurrency.format(low.total) : "—"} detail={low?.date} /></CardContent></Card>
      <Card><CardHeader className="border-b"><CardTitle>Data contract</CardTitle><CardDescription>What these analytics can assert</CardDescription></CardHeader><CardContent className="space-y-3 pt-5 text-sm"><p><strong>{accounts.length}</strong> observed accounts across <strong>{months.length}</strong> snapshots.</p><p><strong>Cash</strong> excludes names ending in stock or stocks.</p><p className="text-muted-foreground">Balance changes are not investment returns. Deposits, withdrawals, and market performance cannot be separated from snapshot values.</p><Alert><AlertTitle>Money-owned history</AlertTitle><AlertDescription>Imported running balances and manual snapshots are stored in the private Money ledger.</AlertDescription></Alert></CardContent></Card>
    </section>
  </>;
}

function viewTitle(view: MoneyTrackerView) {
  return view === "overview" ? "Net worth" : view === "activity" ? "Activity" : view === "spending" ? "Spending" : view === "investments" ? "Investments" : view === "balances" ? "Balances" : "Imports";
}
function viewDescription(view: MoneyTrackerView) {
  return view === "overview" ? "Balances and allocation across every tracked account." : view === "activity" ? "Imported transactions with source and classification context." : view === "spending" ? "Cash flow that excludes transfers, trades, and reverted rows." : view === "investments" ? "Contributions, trades, income, fees, and position events." : view === "balances" ? "Account values and monthly snapshot history." : "Preview, reconcile, and commit private financial statements.";
}
function MoneyNav({ view }: { view: MoneyTrackerView }) { return <nav className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border bg-muted/40 p-1" aria-label="Money"><NavItem view="overview" active={view === "overview"}>Overview</NavItem><NavItem view="activity" active={view === "activity"}>Activity</NavItem><NavItem view="spending" active={view === "spending"}>Spending</NavItem><NavItem view="investments" active={view === "investments"}>Investments</NavItem><NavItem view="balances" active={view === "balances"}>Balances</NavItem><NavItem view="imports" active={view === "imports"}>Imports</NavItem></nav>; }
function NavItem({ view, active, children }: { view: MoneyTrackerView; active: boolean; children: React.ReactNode }) { return <Link to="/money" search={{ view: view === "overview" ? undefined : view }} preload="intent" aria-current={active ? "page" : undefined} className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground">{children}</Link>; }
function PeriodButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <Button type="button" size="sm" variant={active ? "default" : "outline"} onClick={onClick}>{children}</Button>; }
function ChartCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <Card><CardHeader className="border-b"><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="pt-5">{children}</CardContent></Card>; }
function MountedChart({ fallback, children }: { fallback: React.ReactNode; children: React.ReactNode }) { const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), []); return mounted ? children : fallback; }
function ChartFallback({ values }: { values: number[] }) { const latest = values.at(-1); return <div className="grid h-64 place-items-center rounded-md border border-dashed bg-muted/40 text-center"><div><p className="text-sm font-medium">Chart loading</p><p className="mt-1 text-xs text-muted-foreground">{latest === undefined ? "No chart data" : `Latest value ${currency.format(latest)}`}</p></div></div>; }
function LoadingBlock({ className }: { className: string }) { return <div className={`rounded-md bg-muted ${className}`} />; }
function Metric({ label, value, detail, tone: valueTone }: { label: string; value: string; detail?: string; tone?: "positive" | "negative" }) { return <Card><CardContent className="min-w-0 p-4"><p className="text-[.68rem] font-semibold uppercase tracking-[.08em] text-muted-foreground">{label}</p><strong className="mt-1.5 block truncate text-2xl tracking-tight">{value}</strong>{detail ? <span className={valueTone === "negative" ? "mt-1 block truncate text-xs text-rose-400" : valueTone === "positive" ? "mt-1 block truncate text-xs text-emerald-400" : "mt-1 block truncate text-xs text-muted-foreground"}>{detail}</span> : null}</CardContent></Card>; }
function StatRow({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm"><span className="text-muted-foreground">{label}</span><span className="text-right font-mono"><strong className="font-medium text-foreground">{value}</strong>{detail ? <span className="ml-2 text-xs text-muted-foreground">{detail}</span> : null}</span></div>; }
function TrendRow({ label, change }: { label: string; change?: { change: number; percent?: number } }) { return <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm"><span className="text-muted-foreground">{label}</span><span className={`text-right font-mono ${changeClass(change?.change)}`}><strong className="font-medium">{formatSigned(change?.change, true)}</strong><span className="ml-2 text-xs">{formatTrendPercent(change?.percent)}</span></span></div>; }
function AllocationRow({ label, money, stocks }: { label: string; money: number; stocks: number }) { return <div className="space-y-2 px-4 py-3"><div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="font-mono"><span className="text-cyan-300">Cash {money.toFixed(1)}%</span><span className="ml-3 text-purple-300">Stocks {stocks.toFixed(1)}%</span></span></div><div className="flex h-1.5 overflow-hidden rounded-full bg-muted"><div className="bg-cyan-300" style={{ width: `${money}%` }} /><div className="bg-purple-400" style={{ width: `${stocks}%` }} /></div></div>; }
function TooltipValue({ label, value }: { label: string; value: string }) { return <div className="flex min-w-40 items-center justify-between gap-4"><span className="text-muted-foreground">{label}</span><strong>{value}</strong></div>; }
function withChanges(months: Month[]) { return months.slice(1).map((month, index) => ({ ...month, change: month.total - months[index]!.total })); }
function accountRows(accounts: string[], labels: Record<string, string>, latest?: Month, previous?: Month) { return accounts.map((account) => { const value = latest?.values[account]; const oldValue = previous?.values[account]; return { account, label: labels[account] ?? account, value, previous: oldValue, change: value !== undefined && oldValue !== undefined ? value - oldValue : undefined }; }); }
function formatSigned(value?: number, precise = false) { if (value === undefined) return "—"; return `${value >= 0 ? "+" : ""}${(precise ? preciseCurrency : currency).format(value)}`; }
function formatPercent(change?: number, base?: number) { return change === undefined || !base ? "—" : `${change >= 0 ? "+" : ""}${(change / base * 100).toFixed(1)}%`; }
function formatTrendPercent(value?: number) { return value === undefined ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`; }
function formatPoints(value: number) { return `${value >= 0 ? "+" : ""}${value.toFixed(1)} pp`; }
function tone(value?: number): "positive" | "negative" | undefined { return value === undefined ? undefined : value < 0 ? "negative" : "positive"; }
function changeClass(value?: number) { return value === undefined ? "text-muted-foreground" : value < 0 ? "text-rose-400" : "text-emerald-400"; }
function rangeForAccount(months: Month[], account: string) { const values = months.map((month) => month.values[account]).filter((value): value is number => value !== undefined); return values.length ? `${currency.format(Math.min(...values))} – ${currency.format(Math.max(...values))}` : "—"; }
function groupMonth(month: Month, labels: Record<string, string>): GroupedMonth { let money = 0; let stocks = 0; for (const [account, value] of Object.entries(month.values)) { if (moneyTrackerAccountCategory(labels[account] ?? account) === "stocks") stocks += value; else money += value; } return { ...month, money, stocks, trend: month.total }; }
function withLinearTrend(months: GroupedMonth[]) {
  if (months.length < 2) return months;
  const meanX = (months.length - 1) / 2;
  const meanY = months.reduce((sum, month) => sum + month.total, 0) / months.length;
  const slopeNumerator = months.reduce((sum, month, index) => sum + (index - meanX) * (month.total - meanY), 0);
  const slopeDenominator = months.reduce((sum, _month, index) => sum + (index - meanX) ** 2, 0);
  const slope = slopeNumerator / slopeDenominator;
  return months.map((month, index) => ({ ...month, trend: meanY + slope * (index - meanX) }));
}
