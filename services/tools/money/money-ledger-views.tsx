"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Check, FileSpreadsheet, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import type { MoneyTrackerPageData } from "../src/protected-data.js";
import type { MoneyImportPreview } from "./money-import-domain.js";
import { MONEY_CATEGORIES, MONEY_TRANSFER_DISPOSITIONS, REVOLUT_CASH_FORMAT, SPARKASSE_CASH_FORMAT, type MoneyCategory, type MoneyTransferDisposition } from "./money-enums.js";
import type { MoneyActivityPage, MoneyImportReceipt } from "./money-repository.js";
import { Alert, AlertDescription, AlertTitle } from "../src/components/ui/alert.js";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "../src/components/ui/alert-dialog.js";
import { Badge } from "../src/components/ui/badge.js";
import { Button } from "../src/components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../src/components/ui/card.js";
import { Input } from "../src/components/ui/input.js";
import { useIsMobile } from "../src/components/ui/use-mobile.js";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "../src/components/ui/chart.js";

type Activity = MoneyTrackerPageData["activity"][number];

export function MoneyActivityView({ activity, transactionCount, revertedCount, transferReview, transferReviewGroups }: Pick<MoneyTrackerPageData, "activity" | "transactionCount" | "revertedCount" | "transferReview" | "transferReviewGroups">) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [rows, setRows] = useState(activity);
  const [query, setQuery] = useState("");
  const [flow, setFlow] = useState<"all" | Activity["flowKind"]>("all");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [saving, setSaving] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(activity.length < transactionCount);
  const [error, setError] = useState<string>();
  const [ruleCandidate, setRuleCandidate] = useState<Activity>();
  const [ruleAffected, setRuleAffected] = useState<number>();
  const [mobileLimit, setMobileLimit] = useState(50);
  const requestSequence = useRef(0);
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("en-GB");
    return rows.filter((item) => (!reviewOnly || item.needsTransferReview) && (flow === "all" || item.flowKind === flow) && (!normalized || `${item.description} ${item.accountName} ${item.sourceType}`.toLocaleLowerCase("en-GB").includes(normalized)));
  }, [rows, flow, query, reviewOnly]);
  const renderedRows = isMobile ? visible.slice(0, mobileLimit) : visible;
  useEffect(() => setMobileLimit(50), [flow, query, reviewOnly]);
  const categorize = async (item: Activity, category: MoneyCategory, createRule = false) => {
    setSaving(item.id); setError(undefined);
    try {
      const result = await moneyJson<{ ok: true; affectedCount: number }>("/api/money/categories", { transactionId: item.id, category, createRule });
      setRows((current) => current.map((row) => row.id === item.id ? { ...row, category, categoryOrigin: "manual" } : row));
      setRuleCandidate(createRule ? undefined : { ...item, category, categoryOrigin: "manual" });
      setRuleAffected(createRule ? result.affectedCount : undefined);
      await router.invalidate();
      if (createRule && result.affectedCount > 1) await searchAll();
    } catch (caught) { setError(message(caught)); } finally { setSaving(undefined); }
  };
  const loadActivity = async (review: boolean, append = false) => {
    const request = ++requestSequence.current;
    setLoading(true); setError(undefined);
    try {
      const offset = append ? rows.length : 0;
      const parameters = new URLSearchParams({ query, offset: String(offset), limit: "50" });
      if (flow !== "all") parameters.set("flow", flow);
      if (review) parameters.set("review", "true");
      const page = await moneyGet<MoneyActivityPage>(`/api/money/activity?${parameters}`);
      if (request !== requestSequence.current) return;
      setRows((current) => append ? [...current, ...page.items] : [...page.items]);
      setHasMore(page.hasMore);
    } catch (caught) { if (request === requestSequence.current) setError(message(caught)); } finally { if (request === requestSequence.current) setLoading(false); }
  };
  const searchAll = (append = false) => loadActivity(reviewOnly, append);
  useEffect(() => {
    const timeout = window.setTimeout(() => void loadActivity(reviewOnly), 300);
    return () => { window.clearTimeout(timeout); requestSequence.current += 1; };
  }, [flow, query, reviewOnly]);
  const toggleReview = () => setReviewOnly((current) => !current);
  const setGroupDisposition = async (representativeId: string, disposition: MoneyTransferDisposition) => {
    setSaving(representativeId); setError(undefined);
    try {
      await moneyJson("/api/money/transfers", { transactionId: representativeId, disposition, group: true });
      await loadActivity(reviewOnly);
      await router.invalidate();
    } catch (caught) { setError(message(caught)); } finally { setSaving(undefined); }
  };
  return <>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Activity summary">
      <LedgerMetric label="Imported transactions" value={transactionCount.toLocaleString("en-GB")} detail={`${activity.length} newest loaded`} />
      <LedgerMetric label="Unresolved transfer rows" value={(transferReview.unresolvedPositiveCount + transferReview.unresolvedNegativeCount).toLocaleString("en-GB")} detail={`${transferReview.unresolvedPositiveCount} inflows · ${transferReview.unresolvedNegativeCount} outflows`} />
      <LedgerMetric label="Reverted" value={revertedCount.toLocaleString("en-GB")} detail="excluded from analytics" />
      <LedgerMetric label="Matched transfer pairs" value={transferReview.linkedPairs.toLocaleString("en-GB")} detail="two transaction rows per pair" />
    </section>
    {transferReview.unresolvedPositiveCount + transferReview.unresolvedNegativeCount > 0 || reviewOnly ? <Button className="w-fit" type="button" variant="outline" disabled={loading} onClick={toggleReview}>{reviewOnly ? "Show all activity" : "Show transfer review rows"}</Button> : null}
    {reviewOnly ? <Card><CardHeader className="border-b"><CardTitle>Grouped transfer review</CardTitle><CardDescription>Each row groups the same account, source description, source type, currency, and cash direction. A choice applies to every unresolved row in that exact group.</CardDescription></CardHeader><CardContent className="divide-y p-0">{transferReviewGroups.length ? transferReviewGroups.map((group) => <div className="grid items-center gap-3 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_6rem_8rem_12rem]" key={group.representativeId}><div className="min-w-0"><p className="truncate font-medium" title={group.description}>{group.description || group.sourceType}</p><p className="text-xs text-muted-foreground">{group.accountName} · {group.sourceType}</p></div><Badge variant="outline">{group.count} rows</Badge><span className="font-mono sm:text-right">{signedMoney(group.totalMinor, group.currency)}</span><select aria-label={`Transfer treatment for ${group.description}`} className="h-11 rounded-md border border-input bg-background px-2 text-xs sm:h-8" disabled={saving === group.representativeId} defaultValue="" onChange={(event) => void setGroupDisposition(group.representativeId, event.currentTarget.value as MoneyTransferDisposition)}><option value="" disabled>Choose treatment</option>{MONEY_TRANSFER_DISPOSITIONS.map((disposition) => <option key={disposition} value={disposition}>{flowLabel(disposition)}</option>)}</select></div>) : <EmptyLedger title="Transfer review complete" description="No unresolved transfer groups remain." />}</CardContent></Card> : null}
    {error ? <Alert variant="destructive"><AlertTitle>Change not saved</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    {ruleCandidate ? <Alert><AlertTitle>Saved for this row</AlertTitle><AlertDescription><span>Apply this exact description to other transactions in {ruleCandidate.accountName}?</span><Button className="ml-3" type="button" size="sm" variant="outline" disabled={saving === ruleCandidate.id} onClick={() => void categorize(ruleCandidate, ruleCandidate.category, true)}>Create account rule</Button></AlertDescription></Alert> : null}
    {ruleAffected !== undefined ? <Alert><AlertTitle>Account rule applied</AlertTitle><AlertDescription>{ruleAffected.toLocaleString("en-GB")} transaction{ruleAffected === 1 ? "" : "s"} now use this category.</AlertDescription></Alert> : null}
    <Card>
      <CardHeader className="border-b"><div className="flex flex-wrap items-end justify-between gap-3"><div><CardTitle>Transaction activity</CardTitle><CardDescription>Search and filters query the complete ledger. Category rules remain account-scoped.</CardDescription></div><div className="flex w-full flex-wrap items-center gap-2 sm:w-auto"><label className="relative min-w-52 flex-1 sm:flex-none"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><span className="sr-only">Search all transactions</span><Input className="pl-8" type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search all transactions" /></label><select className="h-9 rounded-md border border-input bg-background px-2.5 text-sm" value={flow} onChange={(event) => setFlow(event.currentTarget.value as typeof flow)} aria-label="Filter by flow kind"><option value="all">All flows</option>{["spend", "refund", "transfer", "trade", "investment_income", "fee", "tax", "income", "balance_adjustment"].map((value) => <option key={value} value={value}>{flowLabel(value)}</option>)}</select><Badge variant="outline" aria-live="polite">{loading ? "Searching" : `${visible.length.toLocaleString("en-GB")}${hasMore ? "+" : ""} results`}</Badge></div></div></CardHeader>
      <CardContent className="p-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring" tabIndex={0} role="region" aria-label="Transaction ledger">{visible.length ? <>{isMobile ? <div className="divide-y" role="list" aria-label="Transactions matching the current filters">{renderedRows.map((item) => <article className="space-y-3 p-4" key={item.id} role="listitem"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-semibold" title={item.description}>{item.description || item.sourceType}</h3><p className="mt-1 text-xs text-muted-foreground">{formatDate(item.occurredAt)} · {item.accountName}</p></div><strong className={`shrink-0 font-mono text-sm ${item.amountMinor < 0 ? "text-rose-300" : "text-emerald-300"}`}>{signedMoney(item.amountMinor, item.currency)}</strong></div><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{flowLabel(item.flowKind)}</Badge><Badge variant={item.status === "completed" ? "outline" : "destructive"}>{item.status}</Badge>{item.feeMinor + item.taxMinor ? <span className="text-xs text-muted-foreground">{money(item.feeMinor + item.taxMinor, item.currency)} costs</span> : null}</div><label className="grid gap-1 text-xs text-muted-foreground"><span>Category · {item.categoryOrigin}</span><select className={`h-11 w-full rounded-md border border-input bg-background px-3 text-sm ${item.category === "uncategorized" ? "text-amber-300" : ""}`} value={item.category} disabled={saving === item.id} onChange={(event) => void categorize(item, event.currentTarget.value as MoneyCategory)} aria-label={`Category for ${item.description}`}>{MONEY_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></label></article>)}</div> : <div className="overflow-x-auto"><table className="w-full min-w-[68rem] text-sm"><caption className="sr-only">Transactions matching the current search and flow filters</caption><thead className="border-b text-xs text-muted-foreground"><tr><th className="px-4 py-3 text-left">Date</th><th className="px-4 py-3 text-left">Description</th><th className="px-4 py-3 text-left">Account</th><th className="px-4 py-3 text-left">Flow</th><th className="px-4 py-3 text-left">Category</th><th className="px-4 py-3 text-right">Costs</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3 text-right">Status</th></tr></thead><tbody className="divide-y">{renderedRows.map((item) => <tr key={item.id} className="hover:bg-muted/30"><td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(item.occurredAt)}</td><td className="max-w-80 px-4 py-3"><p className="truncate font-medium" title={item.description}>{item.description || item.sourceType}</p><p className="text-xs text-muted-foreground">{item.sourceType}{item.transferGroupId ? " · linked transfer" : ""}</p></td><td className="whitespace-nowrap px-4 py-3">{item.accountName}</td><td className="px-4 py-3"><Badge variant="outline">{flowLabel(item.flowKind)}</Badge></td><td className="px-4 py-3"><select className={`h-8 rounded-md border border-input bg-background px-2 text-xs ${item.category === "uncategorized" ? "text-amber-300" : ""}`} value={item.category} disabled={saving === item.id} onChange={(event) => void categorize(item, event.currentTarget.value as MoneyCategory)} aria-label={`Category for ${item.description}`}>{MONEY_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select><span className="ml-2 text-[.65rem] text-muted-foreground">{item.categoryOrigin}</span></td><td className="px-4 py-3 text-right font-mono text-muted-foreground">{item.feeMinor + item.taxMinor ? money(item.feeMinor + item.taxMinor, item.currency) : "—"}</td><td className={`px-4 py-3 text-right font-mono font-medium ${item.amountMinor < 0 ? "text-rose-300" : "text-emerald-300"}`}>{signedMoney(item.amountMinor, item.currency)}</td><td className="px-4 py-3 text-right"><Badge variant={item.status === "completed" ? "outline" : "destructive"}>{item.status}</Badge></td></tr>)}</tbody></table></div>}{isMobile && renderedRows.length < visible.length ? <div className="border-t p-3 text-center"><Button type="button" variant="outline" disabled={loading} onClick={() => setMobileLimit((current) => current + 50)}>Show 50 more</Button></div> : hasMore ? <div className="border-t p-3 text-center"><Button type="button" variant="outline" disabled={loading} onClick={() => void searchAll(true)}>{loading ? "Loading…" : "Load more results"}</Button></div> : null}</> : reviewOnly ? <EmptyLedger title="Transfer review complete" description="No unreviewed transfers match the current filters." /> : <EmptyLedger title={transactionCount ? "No matching activity" : "No transactions imported"} description={transactionCount ? "Change the search or flow filter." : "Import a supported statement from Data quality."} />}</CardContent>
    </Card>
  </>;
}

export function MoneyDataView({ accounts, accountLastObserved, accountRoles, categoryRules, imports, marketData, months, revertedCount, spending, transactionCount, transferReview }: Pick<MoneyTrackerPageData, "accounts" | "accountLastObserved" | "accountRoles" | "categoryRules" | "imports" | "marketData" | "months" | "revertedCount" | "spending" | "transactionCount" | "transferReview">) {
  const router = useRouter();
  const [deletingRule, setDeletingRule] = useState<string>();
  const [ruleError, setRuleError] = useState<string>();
  const unresolvedTransfers = transferReview.unresolvedPositiveCount + transferReview.unresolvedNegativeCount;
  const categorized = spending.categories.reduce((sum, item) => sum + (item.category === "uncategorized" ? 0 : item.count), 0);
  const spendingRows = spending.categories.reduce((sum, item) => sum + item.count, 0);
  const categoryCoverage = spendingRows ? categorized / spendingRows * 100 : 0;
  const latestImport = imports.at(0);
  const latestBalanceDate = months.at(-1)?.date;
  const cashAccounts = accounts.filter((account) => accountRoles[account] === "cash");
  const freshAccounts = latestBalanceDate ? cashAccounts.filter((account) => accountLastObserved[account] === latestBalanceDate).length : 0;
  const pricedPositions = marketData.positions.filter((position) => position.state !== "unpriced").length;
  const deleteRule = async (ruleId: string) => {
    setDeletingRule(ruleId); setRuleError(undefined);
    try { await moneyJson("/api/money/categories", { ruleId }, "DELETE"); await router.invalidate(); }
    catch (caught) { setRuleError(message(caught)); }
    finally { setDeletingRule(undefined); }
  };
  return <>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Data quality summary">
      <LedgerMetric label="Ledger rows" value={transactionCount.toLocaleString("en-GB")} detail={`${imports.length.toLocaleString("en-GB")} committed imports`} />
      <LedgerMetric label="Spend rows categorized" value={spendingRows ? `${categoryCoverage.toFixed(1)}%` : "No spending"} detail={`${spending.uncategorizedCount.toLocaleString("en-GB")} rows need a category`} />
      <LedgerMetric label="Transfer review" value={unresolvedTransfers.toLocaleString("en-GB")} detail={`${transferReview.linkedPairs.toLocaleString("en-GB")} matched pairs`} />
      <LedgerMetric label="Fresh cash balances" value={`${freshAccounts} / ${cashAccounts.length}`} detail={latestBalanceDate ? `observed in ${latestBalanceDate}` : "No balance observations"} />
    </section>
    <section className="grid items-start gap-3 lg:grid-cols-3">
      <Card><CardHeader className="border-b"><CardTitle>Data health</CardTitle><CardDescription>Ledger status and analytical limits</CardDescription></CardHeader><CardContent className="divide-y p-0"><QualityRow label="Completed ledger rows" value={(transactionCount - revertedCount).toLocaleString("en-GB")} state="Stored" /><QualityRow label="Reverted source rows" value={revertedCount.toLocaleString("en-GB")} state="Excluded" /><QualityRow label="Unresolved transfer rows" value={unresolvedTransfers.toLocaleString("en-GB")} state={unresolvedTransfers ? "Review" : "Clear"} /><QualityRow label="Open-position pricing" value={`${pricedPositions} / ${marketData.positions.length}`} state={marketData.totals.complete ? "Complete" : "Needs prices"} /></CardContent></Card>
      <Card><CardHeader className="border-b"><CardTitle>Active category rules</CardTitle><CardDescription>Exact descriptions scoped to one account</CardDescription></CardHeader>{ruleError ? <p className="px-4 pt-3 text-xs text-rose-300" role="alert">{ruleError}</p> : null}<CardContent className="divide-y p-0">{categoryRules.length ? categoryRules.map((rule) => <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3" key={rule.id}><div className="min-w-0"><p className="break-words text-sm font-medium">{rule.description}</p><p className="mt-1 text-xs text-muted-foreground">{rule.accountName} · {formatLabel(rule.category)}</p></div><Button type="button" size="sm" variant="ghost" disabled={deletingRule === rule.id} onClick={() => void deleteRule(rule.id)}>{deletingRule === rule.id ? "Removing…" : "Remove"}</Button></div>) : <EmptyLedger title="No category rules" description="Create one after changing a transaction category." />}</CardContent></Card>
      <Card><CardHeader className="border-b"><CardTitle>Repair queue</CardTitle><CardDescription>Current issues with direct destinations</CardDescription></CardHeader><CardContent className="divide-y p-0"><a className="block px-4 py-3 text-sm hover:bg-accent" href="/money?view=transactions"><strong>{spending.uncategorizedCount.toLocaleString("en-GB")}</strong> uncategorized spending rows</a><a className="block px-4 py-3 text-sm hover:bg-accent" href="/money?view=transactions"><strong>{unresolvedTransfers.toLocaleString("en-GB")}</strong> unresolved transfer rows</a><a className="block px-4 py-3 text-sm hover:bg-accent" href="/money?view=investments"><strong>{marketData.positions.length - pricedPositions}</strong> unpriced positions</a><a className="block px-4 py-3 text-sm hover:bg-accent" href="/money?view=accounts"><strong>{cashAccounts.length - freshAccounts}</strong> cash accounts not observed in {latestBalanceDate ?? "the latest month"}</a></CardContent></Card>
    </section>
    {latestImport ? <Alert role="note"><AlertTitle>Latest import</AlertTitle><AlertDescription>{latestImport.filename} added {latestImport.insertedCount.toLocaleString("en-GB")} rows on {formatDate(latestImport.committedAt)}. Raw file bytes were discarded after normalization.</AlertDescription></Alert> : null}
    <MoneyImportsView imports={imports} />
  </>;
}

export function MoneyImportsView({ imports }: Pick<MoneyTrackerPageData, "imports">) {
  const router = useRouter(); const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<MoneyImportFile[]>([]);
  const [busy, setBusy] = useState<"preview" | "commit">(); const [progress, setProgress] = useState(0); const [operationTotal, setOperationTotal] = useState(0);
  const [deleting, setDeleting] = useState<string>(); const [deleteError, setDeleteError] = useState<string>();
  const [reimporting, setReimporting] = useState(false); const [reimportError, setReimportError] = useState<string>();
  const [reimportResult, setReimportResult] = useState<{ importCount: number; transactionCount: number; linkedPairCount: number }>();
  const choose = (selected?: FileList | null) => {
    const next = Array.from(selected ?? []).map((file, index) => ({ id: `${file.name}:${file.size}:${file.lastModified}:${index}`, file }));
    setFiles(next); setBusy(undefined); setProgress(0); setOperationTotal(0);
  };
  const updateFile = (id: string, update: Partial<Pick<MoneyImportFile, "preview" | "receipt" | "error">>) => setFiles((current) => current.map((item) => item.id === id ? { ...item, ...update } : item));
  const clear = () => { setFiles([]); setProgress(0); setOperationTotal(0); if (input.current) input.current.value = ""; };
  const previewFiles = async () => {
    const pending = files.filter((item) => !item.receipt);
    if (!pending.length) return;
    setBusy("preview"); setProgress(0); setOperationTotal(pending.length);
    for (const [index, item] of pending.entries()) {
      updateFile(item.id, { preview: undefined, error: undefined });
      try {
        const form = new FormData(); form.set("file", item.file);
        updateFile(item.id, { preview: await moneyForm<MoneyImportPreview>("/api/money/imports/preview", form), error: undefined });
      } catch (caught) { updateFile(item.id, { preview: undefined, error: message(caught) }); }
      setProgress(index + 1);
    }
    setBusy(undefined);
  };
  const commitFiles = async () => {
    const ready = files.filter((item) => item.preview && !item.receipt);
    if (!ready.length) return;
    setBusy("commit"); setProgress(0); setOperationTotal(ready.length);
    let imported = false;
    for (const [index, item] of ready.entries()) {
      const preview = item.preview;
      if (!preview) continue;
      updateFile(item.id, { error: undefined });
      try {
        const form = new FormData(); form.set("file", item.file); form.set("expectedDigest", preview.digest);
        updateFile(item.id, { receipt: await moneyForm<MoneyImportReceipt>("/api/money/imports", form), error: undefined });
        imported = true;
      } catch (caught) { updateFile(item.id, { error: message(caught) }); }
      setProgress(index + 1);
    }
    setBusy(undefined);
    if (imported) await router.invalidate();
  };
  const deleteImport = async (importId: string) => {
    setDeleting(importId); setDeleteError(undefined);
    try {
      await moneyDelete(`/api/money/imports/${encodeURIComponent(importId)}`);
      await router.invalidate();
    } catch (caught) { setDeleteError(message(caught)); } finally { setDeleting(undefined); }
  };
  const reimportAll = async () => {
    setReimporting(true); setReimportError(undefined); setReimportResult(undefined);
    try {
      const result = await moneyJson<{ ok: true; importCount: number; transactionCount: number; linkedPairCount: number }>("/api/money/imports/reimport", {});
      setReimportResult(result);
      await router.invalidate();
    } catch (caught) { setReimportError(message(caught)); } finally { setReimporting(false); }
  };
  const readyCount = files.filter((item) => item.preview && !item.receipt).length;
  const completedCount = files.filter((item) => item.receipt).length;
  return <section className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,.75fr)]"><Card><CardHeader className="border-b"><CardTitle>Import statements</CardTitle><CardDescription>Sparkasse XLSX, Revolut cash/trading TSV, portfolio CSV, or balance CSV</CardDescription></CardHeader><CardContent className="space-y-4 pt-5"><input ref={input} className="sr-only" tabIndex={-1} type="file" multiple accept=".xlsx,.tsv,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/tab-separated-values,text/csv" disabled={busy !== undefined || reimporting} onChange={(event) => choose(event.currentTarget.files)} /><button type="button" disabled={busy !== undefined || reimporting} className="grid min-h-44 w-full place-items-center rounded-lg border border-dashed bg-muted/25 p-6 text-center transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60" onClick={() => { if (input.current) { input.current.value = ""; input.current.click(); } }}><span><FileSpreadsheet className="mx-auto mb-3 size-8 text-cyan-300" /><strong className="block">{files.length ? `${files.length.toLocaleString("en-GB")} file${files.length === 1 ? "" : "s"} selected` : "Choose money exports"}</strong><span className="mt-1 block text-sm text-muted-foreground">{files.length ? formatBytes(files.reduce((total, item) => total + item.file.size, 0)) : "Select one or more XLSX, TSV, or CSV files, up to 10 MB each"}</span></span></button>{files.length ? <BatchImportPanel files={files} busy={busy} progress={progress} operationTotal={operationTotal} readyCount={readyCount} completedCount={completedCount} onPreview={() => void previewFiles()} onCommit={() => void commitFiles()} onClear={clear} onRemove={(id) => setFiles((current) => current.filter((item) => item.id !== id))} /> : null}</CardContent></Card><Card><CardHeader className="border-b"><div className="flex items-start justify-between gap-3"><div><CardTitle>Import history</CardTitle><CardDescription>Normalized documents can be re-imported at any time</CardDescription></div><AlertDialog><AlertDialogTrigger render={<Button type="button" size="sm" variant="outline" disabled={!imports.length || busy !== undefined || deleting !== undefined || reimporting} />}><RefreshCw />{reimporting ? "Re-importing…" : "Re-import all"}</AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Re-import all documents?</AlertDialogTitle><AlertDialogDescription>This rebuilds categories and transfer links for every normalized import. Manual transaction categories and transfer review choices will be reset, then active category rules will be reapplied. Manual balance entries will stay.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={reimporting}>Cancel</AlertDialogCancel><AlertDialogAction disabled={reimporting} onClick={() => void reimportAll()}>Re-import all</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></CardHeader>{deleteError ? <Alert className="m-3 w-auto" variant="destructive"><AlertTitle>Import not deleted</AlertTitle><AlertDescription>{deleteError}</AlertDescription></Alert> : null}{reimportError ? <Alert className="m-3 w-auto" variant="destructive"><AlertTitle>Re-import failed</AlertTitle><AlertDescription>{reimportError}</AlertDescription></Alert> : null}{reimportResult ? <Alert className="m-3 w-auto"><AlertTitle>Re-import complete</AlertTitle><AlertDescription>{reimportResult.transactionCount.toLocaleString("en-GB")} transactions rebuilt from {reimportResult.importCount.toLocaleString("en-GB")} documents · {reimportResult.linkedPairCount.toLocaleString("en-GB")} transfer pairs linked</AlertDescription></Alert> : null}<CardContent className="divide-y p-0">{imports.length ? imports.map((item) => <div className="space-y-1 px-4 py-3" key={item.id}><div className="flex items-start justify-between gap-3"><strong className="min-w-0 truncate text-sm" title={item.filename}>{item.filename}</strong><div className="flex items-center gap-2"><Badge variant="outline">{item.insertedCount.toLocaleString("en-GB")} new</Badge><AlertDialog><AlertDialogTrigger aria-label={`Delete ${item.filename}`} render={<Button type="button" variant="ghost" size="icon-sm" disabled={deleting !== undefined || reimporting} />}><Trash2 className="text-rose-300" /></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {item.filename}?</AlertDialogTitle><AlertDialogDescription>This cannot be undone. The raw file is already discarded. {item.insertedCount.toLocaleString("en-GB")} transaction{item.insertedCount === 1 ? "" : "s"} and all derived investment events, balance snapshots, and analytics owned by this import will be removed. Data from other imports will stay.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleting === item.id}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={deleting === item.id} onClick={() => void deleteImport(item.id)}>{deleting === item.id ? "Deleting…" : "Delete import data"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></div><p className="text-xs text-muted-foreground">{formatDate(item.committedAt)} · {formatBytes(item.bytes)} · {item.duplicateCount.toLocaleString("en-GB")} duplicates</p><p className="text-[.65rem] uppercase tracking-wide text-muted-foreground">{formatLabel(item.format)}</p></div>) : <EmptyLedger title="No imports yet" description="Completed imports will appear here with their row counts and digest-backed receipt." />}</CardContent></Card></section>;
}

export function MoneySpendingView({ spending }: Pick<MoneyTrackerPageData, "spending">) {
  const [range, setRange] = useState<6 | 12 | "all">(12);
  const observed = spending.months.filter((month) => month.observed);
  const recent = range === "all" ? observed : observed.slice(-range);
  const totals = recent.reduce((sum, month) => ({ spend: sum.spend + month.spendMinor, refunds: sum.refunds + month.refundsMinor, income: sum.income + month.incomeMinor, fees: sum.fees + month.feesMinor, taxes: sum.taxes + month.taxesMinor, net: sum.net + month.netCashFlowMinor }), { spend: 0, refunds: 0, income: 0, fees: 0, taxes: 0, net: 0 });
  const maximum = Math.max(...recent.map((month) => month.spendMinor), 1);
  const rangeLabel = range === "all" ? "All-time" : `${range}m`;
  return <><div className="flex justify-end"><div className="flex gap-1" role="group" aria-label="Cash-flow range">{([6, 12, "all"] as const).map((value) => <Button key={value} size="sm" type="button" variant={range === value ? "default" : "outline"} onClick={() => setRange(value)}>{value === "all" ? "All" : `${value}M`}</Button>)}</div></div><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><LedgerMetric label={`${rangeLabel} spending`} value={money(totals.spend, "EUR")} /><LedgerMetric label={`${rangeLabel} income`} value={money(totals.income, "EUR")} /><LedgerMetric label={`${rangeLabel} net cash flow`} value={signedMoney(totals.net, "EUR")} /><LedgerMetric label="Needs category" value={spending.uncategorizedCount.toLocaleString("en-GB")} detail="all history" /></section><section className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,.65fr)]"><Card><CardHeader className="border-b"><CardTitle>Monthly spending</CardTitle><CardDescription>Completed EUR spend, excluding transfers, trades, adjustments, and reverted rows</CardDescription></CardHeader><CardContent className="space-y-3 pt-5">{recent.length ? recent.map((month) => <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs sm:grid-cols-[4.5rem_minmax(4rem,1fr)_7rem] sm:gap-3" key={month.month}><span className="text-muted-foreground">{month.month}</span><div className="order-3 col-span-2 h-2 overflow-hidden rounded-full bg-muted sm:order-none sm:col-span-1"><div className="h-full rounded-full bg-cyan-300" style={{ width: `${month.spendMinor / maximum * 100}%` }} /></div><span className="text-right font-mono">{money(month.spendMinor, "EUR")}</span></div>) : <EmptyLedger title="No spending history" description="Import a cash or card statement to build full-history analytics." />}</CardContent></Card><Card><CardHeader className="border-b"><CardTitle>Cash-flow reconciliation</CardTitle><CardDescription>{rangeLabel} · all components in the net total</CardDescription></CardHeader><CardContent className="divide-y p-0"><DataRow label="Income" value={money(totals.income, "EUR")} /><DataRow label="Refunds" value={money(totals.refunds, "EUR")} /><DataRow label="Spending" value={`−${money(totals.spend, "EUR")}`} /><DataRow label="Fees" value={`−${money(totals.fees, "EUR")}`} /><DataRow label="Taxes" value={`−${money(totals.taxes, "EUR")}`} /><DataRow label="Net cash flow" value={signedMoney(totals.net, "EUR")} /><p className="px-4 py-3 text-xs text-muted-foreground">Income + refunds − spending − fees − taxes</p></CardContent></Card></section></>;
}

const marketChartConfig = {
  marketValue: { label: "Market value" },
  costBasis: { label: "Cost basis" }
} satisfies ChartConfig;

export function MoneyInvestmentsView({ investments, marketData }: Pick<MoneyTrackerPageData, "investments" | "marketData">) {
  const router = useRouter();
  const [period, setPeriod] = useState<"1y" | "all">("1y");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();
  const cutoff = new Date(marketData.asOf);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const history = marketData.history
    .filter((point) => period === "all" || point.date >= cutoffDate)
    .map((point) => ({ date: point.date, marketValue: point.knownMarketValueMinor / 100, costBasis: point.costBasisMinor / 100 }));
  const pricedPositions = marketData.positions.filter((position) => position.marketValueMinor !== undefined);
  const knownCostBasisMinor = pricedPositions.reduce((sum, position) => sum + position.costBasisMinor, 0);
  const freshCount = marketData.positions.filter((position) => position.state === "fresh").length;
  const staleCount = marketData.positions.filter((position) => position.state === "stale").length;
  const unpricedCount = marketData.positions.filter((position) => position.state === "unpriced").length;
  const latestPriceDate = pricedPositions.flatMap((position) => position.priceDate ? [position.priceDate] : []).sort().at(-1);
  const allocation = (["equity", "etf", "crypto"] as const).map((assetClass) => ({
    assetClass,
    value: pricedPositions.filter((position) => position.assetClass === assetClass).reduce((sum, position) => sum + (position.marketValueMinor ?? 0), 0)
  }));
  const allocationTotal = allocation.reduce((sum, item) => sum + item.value, 0);
  const equityPercent = allocationTotal ? allocation[0]!.value / allocationTotal * 100 : 0;
  const etfPercent = allocationTotal ? allocation[1]!.value / allocationTotal * 100 : 0;
  const donut = allocationTotal
    ? `conic-gradient(#67e8f9 0 ${equityPercent}%, #c084fc ${equityPercent}% ${equityPercent + etfPercent}%, #4ade80 ${equityPercent + etfPercent}% 100%)`
    : "#27272a";
  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(undefined);
    try {
      await moneyJson("/api/money/market-data", {});
      await router.invalidate();
    } catch (error) {
      setRefreshError(message(error));
    } finally {
      setRefreshing(false);
    }
  };

  return <>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Portfolio valuation</h2><p className="text-sm text-muted-foreground">{marketData.positions.length.toLocaleString("en-GB")} open positions · cached closing prices in EUR</p></div>
      <div className="flex items-center gap-2"><Badge variant={unpricedCount ? "destructive" : "outline"}>{unpricedCount ? `${unpricedCount} unpriced` : staleCount ? `${staleCount} stale` : "Updated"}</Badge><Button type="button" variant="outline" disabled={refreshing} onClick={() => void refresh()}><RefreshCw className={refreshing ? "opacity-50" : ""} />{refreshing ? "Refreshing…" : "Refresh prices"}</Button></div>
    </div>
    {refreshError ? <Alert variant="destructive"><AlertTitle>Prices not refreshed</AlertTitle><AlertDescription>{refreshError}. Cached prices remain available.</AlertDescription></Alert> : null}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Portfolio summary">
      <MarketMetric label="Market value" value={money(marketData.totals.knownMarketValueMinor, "EUR")} detail={marketData.totals.complete ? "All open positions priced" : "Known positions only"} />
      <MarketMetric label="FIFO cost basis" value={money(marketData.totals.costBasisMinor, "EUR")} detail="Imported acquisitions and fees" />
      <MarketMetric label="Unrealized gain/loss" value={signedMoney(marketData.totals.knownUnrealizedGainMinor, "EUR")} detail={gainPercent(marketData.totals.knownUnrealizedGainMinor, knownCostBasisMinor)} tone={marketData.totals.knownUnrealizedGainMinor} />
      <MarketMetric label="Latest prices" value={`${pricedPositions.length} / ${marketData.positions.length}`} detail={latestPriceDate ? `${latestPriceDate} · ${freshCount} fresh` : "No cached closes"} />
    </section>
    <section className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(17rem,.7fr)]">
      <Card><CardHeader className="border-b"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Portfolio value</CardTitle><CardDescription>Daily closes with invested FIFO cost basis</CardDescription></div><div className="flex gap-1"><Button type="button" size="sm" variant={period === "1y" ? "secondary" : "ghost"} onClick={() => setPeriod("1y")}>1Y</Button><Button type="button" size="sm" variant={period === "all" ? "secondary" : "ghost"} onClick={() => setPeriod("all")}>All</Button></div></div></CardHeader><CardContent className="pt-5">{history.length ? <><ChartContainer config={marketChartConfig} className="h-[19rem] w-full aspect-auto" initialDimension={{ width: 760, height: 304 }} role="img" aria-label="Historical market value and FIFO cost basis in euro"><AreaChartForPortfolio data={history} /></ChartContainer><PortfolioHistoryDisclosure history={history} /></> : <EmptyLedger title="No valuation history yet" description="Run the first price refresh to populate historical closing prices." />}</CardContent></Card>
      <Card><CardHeader className="border-b"><CardTitle>Allocation and data</CardTitle><CardDescription>Known market value and source freshness</CardDescription></CardHeader><CardContent className="pt-5"><div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-4"><div className="relative aspect-square rounded-full" style={{ background: donut }} aria-hidden="true"><div className="absolute inset-[1.35rem] rounded-full bg-card" /></div><div className="space-y-2">{allocation.map((item) => <AllocationRow key={item.assetClass} label={item.assetClass === "equity" ? "Stocks" : item.assetClass === "etf" ? "ETFs" : "Crypto"} value={allocationTotal ? item.value / allocationTotal * 100 : 0} />)}</div></div><div className="mt-5 divide-y border-t"><DataRow label="Yahoo closes" value={`${freshCount} fresh${staleCount ? `, ${staleCount} stale` : ""}`} /><DataRow label="ECB USD/EUR" value={pricedPositions.some((position) => position.currency === "USD") ? "Applied per close" : "Not required"} /><DataRow label="Unpriced" value={String(unpricedCount)} /></div><p className="mt-4 text-xs text-muted-foreground">Closing prices are suitable for personal tracking, not execution or tax reporting.</p></CardContent></Card>
    </section>
    <Card><CardHeader className="border-b"><div className="flex items-center justify-between gap-3"><div><CardTitle>Largest positions</CardTitle><CardDescription>Current value, FIFO basis, average buy price, and unrealized return</CardDescription></div><Badge variant="outline">{marketData.positions.length} open</Badge></div></CardHeader><CardContent className="overflow-x-auto p-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring" tabIndex={0} role="region" aria-label="Current portfolio positions"><table className="w-full min-w-[54rem] text-sm"><caption className="sr-only">Current portfolio positions ordered by known market value</caption><thead className="border-b text-xs text-muted-foreground"><tr><th className="px-4 py-3 text-left">Instrument</th><th className="px-4 py-3 text-left">Class</th><th className="px-4 py-3 text-right">Quantity</th><th className="px-4 py-3 text-right">Close</th><th className="px-4 py-3 text-right">Value</th><th className="px-4 py-3 text-right">Gain/loss</th><th className="px-4 py-3 text-right">State</th></tr></thead><tbody className="divide-y">{marketData.positions.map((position) => <tr key={position.canonicalKey} className="hover:bg-muted/30"><td className="px-4 py-3"><strong>{position.name}</strong><span className="mt-0.5 block text-xs text-muted-foreground">{position.providerKey ?? position.canonicalKey}</span><span className="mt-1 block text-xs text-muted-foreground">FIFO {money(position.costBasisMinor, "EUR")} · avg {averageBuy(position.costBasisMinor, position.quantity)} · {position.unrealizedGainMinor === undefined ? "—" : gainPercent(position.unrealizedGainMinor, position.costBasisMinor)}</span></td><td className="px-4 py-3 text-muted-foreground">{position.assetClass}</td><td className="px-4 py-3 text-right font-mono">{position.quantity}</td><td className="px-4 py-3 text-right font-mono">{position.close && position.currency ? decimalMoney(position.close, position.currency) : "—"}</td><td className="px-4 py-3 text-right font-mono font-medium">{position.marketValueMinor === undefined ? "—" : money(position.marketValueMinor, "EUR")}</td><td className={`px-4 py-3 text-right font-mono ${toneClass(position.unrealizedGainMinor)}`}>{position.unrealizedGainMinor === undefined ? "—" : signedMoney(position.unrealizedGainMinor, "EUR")}</td><td className="px-4 py-3 text-right"><Badge variant={position.state === "unpriced" ? "destructive" : "outline"}>{position.state}{position.priceDate ? ` · ${position.priceDate}` : ""}</Badge></td></tr>)}</tbody></table></CardContent></Card>
    <InvestmentActivityHistory investments={investments} />
  </>;
}

function AreaChartForPortfolio({ data }: { data: readonly { date: string; marketValue: number; costBasis: number }[] }) {
  return <ComposedChart data={data} margin={{ left: 4, right: 12, top: 8 }}><defs><linearGradient id="money-market-value-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#67e8f9" stopOpacity={0.3} /><stop offset="95%" stopColor="#67e8f9" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} minTickGap={28} /><YAxis tickLine={false} axisLine={false} width={74} tickFormatter={(value: number) => compactEuro(value)} /><ChartTooltip content={<ChartTooltipContent formatter={(value) => preciseEuro(Number(value))} />} /><Area dataKey="marketValue" name="Market value" type="monotone" fill="url(#money-market-value-fill)" stroke="#67e8f9" strokeWidth={2} /><Line dataKey="costBasis" name="Cost basis" type="stepAfter" stroke="#a1a1aa" strokeWidth={1.5} strokeDasharray="6 5" dot={false} /></ComposedChart>;
}

function PortfolioHistoryDisclosure({ history }: { history: readonly { date: string; marketValue: number; costBasis: number }[] }) {
  return <details className="mt-3 border-t pt-3"><summary className="w-fit cursor-pointer text-xs font-medium text-muted-foreground">View exact portfolio data</summary><div className="mt-3 max-h-80 overflow-auto rounded-md border"><table className="w-full min-w-80 text-xs"><thead className="sticky top-0 border-b bg-card text-muted-foreground"><tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-right">Market value</th><th className="px-3 py-2 text-right">FIFO basis</th></tr></thead><tbody className="divide-y">{[...history].reverse().map((point) => <tr key={point.date}><td className="px-3 py-2">{point.date}</td><td className="px-3 py-2 text-right font-mono">{preciseEuro(point.marketValue)}</td><td className="px-3 py-2 text-right font-mono">{preciseEuro(point.costBasis)}</td></tr>)}</tbody></table></div></details>;
}

function InvestmentActivityHistory({ investments }: Pick<MoneyTrackerPageData, "investments">) {
  const { totals, positions, realized } = investments;
  return <><Alert role="note"><AlertTitle>Imported investment activity</AlertTitle><AlertDescription>Realized gains use FIFO acquisition lots, actual EUR cash totals, and split-adjusted quantities. They include transaction fees and exclude taxes.</AlertDescription></Alert>{realized.totals.unmatchedSaleCount ? <Alert variant="destructive"><AlertTitle>Incomplete acquisition history</AlertTitle><AlertDescription>{realized.totals.unmatchedSaleCount.toLocaleString("en-GB")} sale{realized.totals.unmatchedSaleCount === 1 ? "" : "s"} could not be fully matched to an earlier acquisition. Unmatched proceeds are excluded from realized gains.</AlertDescription></Alert> : null}<section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><LedgerMetric label="Investment events" value={totals.eventCount.toLocaleString("en-GB")} /><LedgerMetric label="Bought" value={money(totals.boughtMinor, "EUR")} /><LedgerMetric label="Sold" value={money(totals.soldMinor, "EUR")} /><LedgerMetric label="Realized gain/loss" value={signedMoney(realized.totals.gainMinor, "EUR")} detail="FIFO · after transaction fees" /><LedgerMetric label="Income" value={money(totals.incomeMinor, "EUR")} /><LedgerMetric label="Fees + taxes" value={money(totals.feesMinor + totals.taxesMinor, "EUR")} /></section><Card><CardHeader className="border-b"><CardTitle>Realized gains and losses</CardTitle><CardDescription>Matched sales using FIFO cost basis, EUR cash totals, and split-adjusted lots</CardDescription></CardHeader><CardContent className="overflow-x-auto p-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring" tabIndex={0} role="region" aria-label="Realized investment gains table">{realized.positions.length ? <table className="w-full min-w-[48rem] text-sm"><caption className="sr-only">Realized gains and losses by asset</caption><thead className="border-b text-xs text-muted-foreground"><tr><th className="px-4 py-3 text-left">Asset</th><th className="px-4 py-3 text-right">Sales</th><th className="px-4 py-3 text-right">Quantity sold</th><th className="px-4 py-3 text-right">Net proceeds</th><th className="px-4 py-3 text-right">FIFO basis</th><th className="px-4 py-3 text-right">Gain/loss</th><th className="px-4 py-3 text-right">Return</th></tr></thead><tbody className="divide-y">{realized.positions.map((item) => <tr key={item.symbol}><td className="px-4 py-3 font-medium">{item.symbol}</td><td className="px-4 py-3 text-right font-mono">{item.saleCount}</td><td className="px-4 py-3 text-right font-mono">{item.soldQuantity}</td><td className="px-4 py-3 text-right font-mono">{money(item.proceedsMinor, "EUR")}</td><td className="px-4 py-3 text-right font-mono">{money(item.costBasisMinor, "EUR")}</td><td className={`px-4 py-3 text-right font-mono font-medium ${item.gainMinor < 0 ? "text-rose-300" : "text-emerald-300"}`}>{signedMoney(item.gainMinor, "EUR")}</td><td className={`px-4 py-3 text-right font-mono ${item.gainMinor < 0 ? "text-rose-300" : "text-emerald-300"}`}>{gainPercent(item.gainMinor, item.costBasisMinor)}</td></tr>)}</tbody></table> : <EmptyLedger title="No realized gains yet" description="Realized gains appear after a sale can be matched to earlier acquisition lots." />}</CardContent></Card><Card><CardHeader className="border-b"><CardTitle>Trade-derived quantities</CardTitle><CardDescription>Buy, sell, and split events with cumulative EUR cash flows by symbol</CardDescription></CardHeader><CardContent className="overflow-x-auto p-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring" tabIndex={0} role="region" aria-label="Trade-derived investment quantities table">{positions.length ? <table className="w-full min-w-[52rem] text-sm"><caption className="sr-only">Trade-derived quantities and cumulative cash flows by asset</caption><thead className="border-b text-xs text-muted-foreground"><tr><th className="px-4 py-3 text-left">Asset</th><th className="px-4 py-3 text-left">Class</th><th className="px-4 py-3 text-right">Quantity</th><th className="px-4 py-3 text-right">Bought</th><th className="px-4 py-3 text-right">Sold</th><th className="px-4 py-3 text-right">Income</th><th className="px-4 py-3 text-right">Costs</th></tr></thead><tbody className="divide-y">{positions.map((item, index) => <tr key={`${item.symbol}:${item.name ?? index}`}><td className="px-4 py-3"><strong>{item.symbol}</strong>{item.name ? <span className="ml-2 text-xs text-muted-foreground">{item.name}</span> : null}</td><td className="px-4 py-3 text-muted-foreground">{item.assetClass ?? "—"}</td><td className="px-4 py-3 text-right font-mono">{item.quantity}</td><td className="px-4 py-3 text-right font-mono">{money(item.boughtMinor, item.currency)}</td><td className="px-4 py-3 text-right font-mono">{money(item.soldMinor, item.currency)}</td><td className="px-4 py-3 text-right font-mono text-emerald-300">{money(item.incomeMinor, item.currency)}</td><td className="px-4 py-3 text-right font-mono text-rose-300">{money(item.feesMinor + item.taxesMinor, item.currency)}</td></tr>)}</tbody></table> : <EmptyLedger title="No investment events" description="Import a supported trading TSV or portfolio CSV." />}</CardContent></Card></>;
}

export function MoneyPlanningCard({ planning }: Pick<MoneyTrackerPageData, "planning">) {
  return <Card><CardHeader className="border-b"><CardTitle>Run-rate scenario</CardTitle><CardDescription>Median of the latest 6 to 12 consecutive months with imported cash-flow activity. The current partial month is excluded.</CardDescription></CardHeader><CardContent className="pt-5">{planning.ready ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><div><p className="text-xs text-muted-foreground">Monthly median</p><strong className="mt-1 block font-mono text-xl">{signedMoney(planning.medianMonthlyNetMinor, "EUR")}</strong><p className="mt-1 text-xs text-muted-foreground">{planning.observedMonthCount} consecutive activity months</p></div>{planning.projections.map((item) => <div className="rounded-md border bg-muted/20 p-3" key={item.months}><p className="text-xs text-muted-foreground">Simple {item.months}-month run rate</p><strong className={`mt-1 block font-mono text-lg ${item.changeMinor < 0 ? "text-rose-300" : "text-emerald-300"}`}>{signedMoney(item.changeMinor, "EUR")}</strong></div>)}</div> : planning.unresolvedTransferCount ? <Alert><AlertTitle>Scenario needs transfer review</AlertTitle><AlertDescription>{planning.unresolvedTransferCount.toLocaleString("en-GB")} unlinked transfer-like inflows or outflows still need classification. Scenarios stay hidden until review is complete.</AlertDescription></Alert> : <Alert><AlertTitle>Not enough history</AlertTitle><AlertDescription>At least six consecutive past months with imported cash-flow activity are required. You currently have {planning.observedMonthCount}.</AlertDescription></Alert>}</CardContent></Card>;
}

export function MoneyBalanceEntry({ accounts, accountLabels }: { accounts: string[]; accountLabels: Record<string, string> }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>(); const [saved, setSaved] = useState(false); const [accountId, setAccountId] = useState(accounts[0] ?? "new");
  const submit = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const element = event.currentTarget; setBusy(true); setError(undefined); setSaved(false); const form = new FormData(element); try { await moneyJson("/api/money/balances", { ...(accountId === "new" ? { accountName: String(form.get("accountName") ?? "") } : { accountId }), date: String(form.get("date") ?? ""), value: String(form.get("value") ?? ""), currency: "EUR" }); setSaved(true); element.reset(); await router.invalidate(); } catch (caught) { setError(message(caught)); } finally { setBusy(false); } };
  return <Card><CardHeader className="border-b"><CardTitle>Add cash balance snapshot</CardTitle><CardDescription>Update an existing cash account or explicitly create a new manual account</CardDescription></CardHeader><CardContent className="pt-5"><form className={`grid gap-3 ${accountId === "new" ? "lg:grid-cols-[minmax(11rem,1fr)_minmax(11rem,1fr)_10rem_10rem_auto]" : "sm:grid-cols-[minmax(12rem,1fr)_10rem_10rem_auto]"}`} onSubmit={(event) => void submit(event)}><label className="space-y-1 text-xs text-muted-foreground">Account<select className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={accountId} onChange={(event) => setAccountId(event.currentTarget.value)}>{accounts.map((account) => <option key={account} value={account}>{accountLabels[account] ?? account}</option>)}<option value="new">New manual account…</option></select></label>{accountId === "new" ? <label className="space-y-1 text-xs text-muted-foreground">New account name<Input name="accountName" required maxLength={100} placeholder="Cash account" /></label> : null}<label className="space-y-1 text-xs text-muted-foreground">Date<Input name="date" type="date" required /></label><label className="space-y-1 text-xs text-muted-foreground">Value<Input name="value" inputMode="decimal" required placeholder="0.00" /></label><Button className="self-end" disabled={busy}>{busy ? "Saving…" : "Save snapshot"}</Button></form>{error ? <p className="mt-3 text-sm text-rose-300" role="alert">{error}</p> : null}{saved ? <p className="mt-3 text-sm text-emerald-300" role="status">Snapshot saved.</p> : null}</CardContent></Card>;
}

type MoneyImportFile = Readonly<{ id: string; file: File; preview?: MoneyImportPreview; receipt?: MoneyImportReceipt; error?: string }>;

function BatchImportPanel({ files, busy, progress, operationTotal, readyCount, completedCount, onPreview, onCommit, onClear, onRemove }: { files: readonly MoneyImportFile[]; busy?: "preview" | "commit"; progress: number; operationTotal: number; readyCount: number; completedCount: number; onPreview: () => void; onCommit: () => void; onClear: () => void; onRemove: (id: string) => void }) {
  const complete = completedCount === files.length;
  const operationPosition = Math.min(progress + 1, operationTotal);
  return <div className="rounded-lg border bg-muted/20">
    <div className="divide-y">{files.map((item) => {
      const preview = item.preview;
      return <div className="space-y-2 p-4" key={item.id}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><strong className="truncate text-sm" title={item.file.name}>{item.file.name}</strong>{item.receipt ? <Badge variant="outline"><Check />{item.receipt.replay ? "Already imported" : `${item.receipt.insertedCount.toLocaleString("en-GB")} new`}</Badge> : preview ? <Badge variant="outline">Ready</Badge> : item.error ? <Badge variant="destructive">Needs attention</Badge> : <Badge variant="outline">Selected</Badge>}</div>
            <p className="mt-1 text-xs text-muted-foreground">{formatBytes(item.file.size)}{preview ? ` · ${formatLabel(preview.format)} · ${preview.dateRange.from} to ${preview.dateRange.to} · ${preview.rowCount.toLocaleString("en-GB")} rows · ${preview.duplicateCount.toLocaleString("en-GB")} known duplicates${preview.investmentEventCount ? ` · ${preview.investmentEventCount.toLocaleString("en-GB")} investment events` : ""}` : ""}</p>
          </div>
          {busy === undefined && !item.receipt ? <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => onRemove(item.id)} aria-label={`Remove ${item.file.name}`}><X className="size-4" /></button> : null}
        </div>
        {preview ? <div className="grid gap-2 sm:grid-cols-2">{preview.accounts.map((account) => <div className="rounded-md border bg-background p-3" key={account.externalRef}><div className="flex justify-between gap-3"><strong className="truncate text-xs">{account.name}</strong><span className="font-mono text-xs">{account.endingBalanceMinor === undefined ? "—" : money(account.endingBalanceMinor, account.currency)}</span></div><p className="mt-1 text-[.68rem] text-muted-foreground">{account.rowCount.toLocaleString("en-GB")} rows · {account.revertedCount} reverted · {reconciliationLabel(preview, account.reconciliationMismatchCount)}</p></div>)}</div> : null}
        {preview?.warnings.map((warning) => <Alert key={warning}><AlertTitle>Review warning</AlertTitle><AlertDescription>{warning}</AlertDescription></Alert>)}
        {item.error ? <p className="text-sm text-rose-300" role="alert">{item.error}</p> : null}
        {item.receipt ? <p className="text-xs text-muted-foreground">{item.receipt.insertedCount.toLocaleString("en-GB")} rows inserted and {item.receipt.duplicateCount.toLocaleString("en-GB")} duplicates skipped.</p> : null}
      </div>;
    })}</div>
    <div className="flex flex-wrap items-center gap-2 border-t p-4"><Button type="button" disabled={busy !== undefined || complete} onClick={readyCount ? onCommit : onPreview}><Upload />{busy === "preview" ? `Previewing ${operationPosition} of ${operationTotal}…` : busy === "commit" ? `Importing ${operationPosition} of ${operationTotal}…` : readyCount ? `Import ${readyCount} file${readyCount === 1 ? "" : "s"}` : complete ? "Import complete" : `Preview ${files.length - completedCount} file${files.length - completedCount === 1 ? "" : "s"}`}</Button><Button type="button" variant="outline" disabled={busy !== undefined} onClick={onClear}>{complete ? "Choose more files" : "Clear"}</Button>{completedCount ? <span className="text-xs text-muted-foreground" role="status">{completedCount} of {files.length} files imported</span> : null}</div>
    <p className="border-t px-4 py-3 text-xs text-muted-foreground">Files are committed one at a time. Every commit reparses and digest-checks the file; raw bytes are never retained.</p>
  </div>;
}
function MarketMetric({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: number }) { return <Card><CardContent className="p-4"><p className="text-[.68rem] font-semibold uppercase tracking-[.08em] text-muted-foreground">{label}</p><strong className={`mt-1.5 block text-2xl tracking-tight ${toneClass(tone)}`}>{value}</strong>{detail ? <span className="mt-1 block text-xs text-muted-foreground">{detail}</span> : null}</CardContent></Card>; }
function AllocationRow({ label, value }: { label: string; value: number }) { return <div className="flex items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">{label}</span><strong className="font-mono">{value.toFixed(1)}%</strong></div>; }
function DataRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 py-2.5 text-xs"><span className="text-muted-foreground">{label}</span><strong>{value}</strong></div>; }
function LedgerMetric({ label, value, detail }: { label: string; value: string; detail?: string }) { return <Card><CardContent className="p-4"><p className="text-[.68rem] font-semibold uppercase tracking-[.08em] text-muted-foreground">{label}</p><strong className="mt-1.5 block text-2xl tracking-tight">{value}</strong>{detail ? <span className="mt-1 block text-xs text-muted-foreground">{detail}</span> : null}</CardContent></Card>; }
function QualityRow({ label, value, state }: { label: string; value: string; state: string }) { return <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-sm"><div><p className="font-medium">{label}</p><p className="mt-0.5 text-xs text-muted-foreground">{value}</p></div><Badge variant={state === "Review" || state === "Needs prices" ? "destructive" : "outline"}>{state}</Badge></div>; }
function EmptyLedger({ title, description }: { title: string; description: string }) { return <div className="grid min-h-36 place-items-center p-5 text-center"><div><p className="font-medium">{title}</p><p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">{description}</p></div></div>; }
function isTreatableTransfer(item: Activity) { return item.flowKind === "transfer" && item.status === "completed"; }
async function moneyForm<Result>(url: string, form: FormData): Promise<Result> { return moneyFetch<Result>(url, { body: form }); }
async function moneyJson<Result = { ok: true }>(url: string, value: Record<string, unknown>, method = "POST"): Promise<Result> { return moneyFetch<Result>(url, { method, body: JSON.stringify(value), headers: { "Content-Type": "application/json" } }); }
async function moneyFetch<Result>(url: string, init: Pick<RequestInit, "body" | "headers" | "method">): Promise<Result> { const response = await fetch(url, { method: "POST", ...init }); const body = await response.json() as { message?: unknown } | Result; if (!response.ok) throw new Error(typeof (body as { message?: unknown }).message === "string" ? (body as { message: string }).message : `Money request failed with status ${response.status}.`); return body as Result; }
async function moneyGet<Result>(url: string): Promise<Result> { const response = await fetch(url); const body = await response.json() as { message?: unknown } | Result; if (!response.ok) throw new Error(typeof (body as { message?: unknown }).message === "string" ? (body as { message: string }).message : `Money request failed with status ${response.status}.`); return body as Result; }
async function moneyDelete<Result = { ok: true }>(url: string): Promise<Result> { const response = await fetch(url, { method: "DELETE" }); const body = await response.json() as { message?: unknown } | Result; if (!response.ok) throw new Error(typeof (body as { message?: unknown }).message === "string" ? (body as { message: string }).message : `Money request failed with status ${response.status}.`); return body as Result; }
function message(error: unknown) { return error instanceof Error ? error.message : "The money request failed."; }
function money(minor: number, currency: string) { return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(minor / 100); }
function decimalMoney(value: string, currency: string) { return new Intl.NumberFormat("de-DE", { style: "currency", currency, maximumFractionDigits: 4 }).format(Number(value)); }
function averageBuy(costBasisMinor: number, quantity: string) { const units = Number(quantity); return units > 0 ? new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(costBasisMinor / 100 / units) : "—"; }
function preciseEuro(value: number) { return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value); }
function compactEuro(value: number) { return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 }).format(value); }
function signedMoney(minor: number, currency: string) { return `${minor >= 0 ? "+" : ""}${money(minor, currency)}`; }
function toneClass(value?: number) { return value === undefined || value === 0 ? "" : value < 0 ? "text-rose-300" : "text-emerald-300"; }
function gainPercent(gainMinor: number, costBasisMinor: number) { return costBasisMinor ? `${gainMinor >= 0 ? "+" : ""}${(gainMinor / costBasisMinor * 100).toFixed(1)}%` : "—"; }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/Berlin" }).format(new Date(value)); }
function formatBytes(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function flowLabel(flow: string) { return flow.replaceAll("_", " "); }
function formatLabel(value: string) { return value.replace(/_v\d$/, "").replaceAll("_", " "); }
function reconciliationLabel(preview: MoneyImportPreview, mismatchCount: number) { return preview.format !== REVOLUT_CASH_FORMAT && preview.format !== SPARKASSE_CASH_FORMAT ? "no running balance to reconcile" : mismatchCount ? `${mismatchCount} mismatches` : "running balances reconciled"; }
