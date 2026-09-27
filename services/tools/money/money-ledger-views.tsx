"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import {
  Check,
  FileSpreadsheet,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";
import type { MoneyTrackerPageData } from "../src/protected-data.js";
import { formatPercent, MoneyCheckInPicker } from "./money-checkin-card.js";
import type { MoneyImportPreview } from "./money-import-domain.js";
import {
  MONEY_CATEGORIES,
  REVOLUT_CASH_FORMAT,
  SPARKASSE_CASH_FORMAT,
  type MoneyCategory,
} from "./money-enums.js";
import type {
  MoneyActivityPage,
  MoneyActivitySortKey,
  MoneyImportReceipt,
} from "./money-repository.js";
import {
  compareMoneyValues,
  MoneySortableHead,
  MoneyTableSearch,
  nextMoneySort,
  type MoneySort,
} from "./money-data-table.js";
import { MoneyCategoryPicker, moneyCategoryLabel } from "./money-category-picker.js";
import {
  DivergingBar,
  EmptyState,
  formatDay,
  formatEuro,
  formatMinor,
  formatRatio,
  Legend,
  LegendItem,
  MoneyPanel,
  PanelBody,
  PanelFooter,
  Segmented,
  SERIES,
  ShareBar,
  Stat,
  StatStrip,
  TableTwin,
  toneClass,
} from "./money-ui.js";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "../src/components/ui/alert.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../src/components/ui/alert-dialog.js";
import { Badge } from "../src/components/ui/badge.js";
import { Button } from "../src/components/ui/button.js";
import { NativeSelect, NativeSelectOption } from "../src/components/ui/native-select.js";
import { useIsMobile } from "../src/components/ui/use-mobile.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../src/components/ui/tooltip.js";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "../src/components/ui/chart.js";

type Activity = MoneyTrackerPageData["activity"][number];
type PositionSortKey =
  | "name"
  | "class"
  | "quantity"
  | "close"
  | "value"
  | "gain"
  | "return"
  | "since"
  | "state";
type RealizedSortKey =
  "asset" | "sales" | "quantity" | "proceeds" | "basis" | "gain" | "return";
type InvestmentActivitySortKey =
  "asset" | "class" | "quantity" | "bought" | "sold" | "income" | "costs";

export function MoneyActivityView({
  activity,
  accounts = [],
  accountLabels = {},
  transactionCount,
  reviewCounts,
  initialCategory,
  initialReviewOnly = false,
  initialFromMonth,
  initialToMonth,
}: Pick<MoneyTrackerPageData, "activity" | "transactionCount" | "reviewCounts"> &
  Partial<Pick<MoneyTrackerPageData, "accounts" | "accountLabels">> & { initialCategory?: MoneyCategory; initialReviewOnly?: boolean; initialFromMonth?: string; initialToMonth?: string }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [rows, setRows] = useState(activity);
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState("all");
  const [category, setCategory] = useState<"all" | MoneyCategory>(initialCategory ?? "all");
  const [sort, setSort] = useState<MoneySort<MoneyActivitySortKey>>({ key: "date", direction: "desc" });
  const [reviewOnly, setReviewOnly] = useState(initialReviewOnly);
  const [saving, setSaving] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(activity.length < transactionCount);
  const [resultTotal, setResultTotal] = useState(transactionCount);
  const [error, setError] = useState<string>();
  const [ruleOffer, setRuleOffer] = useState<Readonly<{ item: Activity; category: MoneyCategory }>>();
  const [notice, setNotice] = useState<string>();
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(() => new Set());
  const requestSequence = useRef(0);
  const reviewTotal = reviewCounts.uncategorized + reviewCounts.transfers;
  const loadActivity = async (append = false) => {
    const request = ++requestSequence.current;
    setLoading(true);
    setError(undefined);
    try {
      const parameters = new URLSearchParams({ query, offset: String(append ? rows.length : 0), limit: "50", sort: sort.key, direction: sort.direction });
      if (account !== "all") parameters.set("accountId", account);
      if (category !== "all") parameters.set("category", category);
      if (initialFromMonth) parameters.set("fromMonth", initialFromMonth);
      if (initialToMonth) parameters.set("toMonth", initialToMonth);
      if (reviewOnly) parameters.set("review", "true");
      const page = await moneyGet<MoneyActivityPage>(`/api/money/activity?${parameters}`);
      if (request !== requestSequence.current) return;
      setRows((current) => (append ? [...current, ...page.items] : [...page.items]));
      setResultTotal(page.total);
      setHasMore(page.hasMore);
    } catch (caught) {
      if (request === requestSequence.current) setError(message(caught));
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    const timeout = window.setTimeout(() => void loadActivity(), 300);
    return () => {
      window.clearTimeout(timeout);
      requestSequence.current += 1;
    };
  }, [account, category, query, reviewOnly, sort, initialFromMonth, initialToMonth]);
  const categorize = async (items: readonly Activity[], next: MoneyCategory, createRule = false) => {
    setSaving(items.length === 1 ? items[0]!.id : "bulk");
    setError(undefined);
    setNotice(undefined);
    try {
      let affected = 0;
      for (const item of items) {
        const result = await moneyJson<{ ok: true; affectedCount: number }>("/api/money/categories", { transactionId: item.id, category: next, createRule });
        affected += result.affectedCount;
      }
      const changed = new Set(items.map((item) => item.id));
      setRows((current) => current.map((row) => (changed.has(row.id) ? { ...row, category: next, categoryOrigin: "manual" } : row)));
      const single = items.length === 1 ? items[0]! : undefined;
      setRuleOffer(!createRule && single && (single.flowKind === "spend" || single.flowKind === "refund") ? { item: single, category: next } : undefined);
      setNotice(createRule ? `Rule saved. ${affected.toLocaleString("en-GB")} row${affected === 1 ? "" : "s"} now use ${moneyCategoryLabel(next)}.` : items.length > 1 ? `${items.length} rows now use ${moneyCategoryLabel(next)}.` : undefined);
      setSelectedRows(new Set());
      await router.invalidate();
      if (createRule) await loadActivity();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setSaving(undefined);
    }
  };
  const changeSort = (key: MoneyActivitySortKey) => setSort((current) => nextMoneySort(current, key, ["description", "account", "category"]));
  const toggleRow = (id: string) =>
    setSelectedRows((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectedItems = rows.filter((row) => selectedRows.has(row.id));
  const chip = (item: Activity) =>
    needsTransferTreatment(item) ? (
      <Link to="/money" search={{ view: "review" }} className="inline-flex h-7 items-center rounded-md border border-dashed border-control-border px-2 text-[.8125rem] text-muted-foreground hover:text-foreground">
        Transfer to classify
      </Link>
    ) : (
      <MoneyCategoryPicker compact value={item.category} disabled={saving !== undefined} ariaLabel={`Category for ${item.description}: ${moneyCategoryLabel(item.category)}`} onValue={(next) => void categorize([item], next)} />
    );
  return (
    <div className="money-stack">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Change not saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <MoneyPanel>
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3.5 pb-3">
          <MoneyTableSearch value={query} onValue={setQuery} placeholder="Search description or account" className="min-w-52 flex-1 sm:max-w-sm" />
          <NativeSelect size="sm" value={account} aria-label="Filter by account" onChange={(event) => setAccount(event.currentTarget.value)}>
            <NativeSelectOption value="all">All accounts</NativeSelectOption>
            {accounts.map((id) => <NativeSelectOption key={id} value={id}>{accountLabels[id] ?? id}</NativeSelectOption>)}
          </NativeSelect>
          <NativeSelect size="sm" value={category} aria-label="Filter by category" onChange={(event) => setCategory(event.currentTarget.value as typeof category)}>
            <NativeSelectOption value="all">All categories</NativeSelectOption>
            {MONEY_CATEGORIES.map((value) => <NativeSelectOption key={value} value={value}>{moneyCategoryLabel(value)}</NativeSelectOption>)}
          </NativeSelect>
          <Button type="button" size="sm" variant={reviewOnly ? "secondary" : "outline"} aria-pressed={reviewOnly} onClick={() => setReviewOnly((current) => !current)}>
            Needs review
            {reviewTotal ? <span className="money-review-badge ml-0">{reviewTotal > 999 ? "999+" : reviewTotal}</span> : null}
          </Button>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {loading ? "Searching…" : `${resultTotal.toLocaleString("en-GB")} rows`}
          </span>
        </div>
        {notice || ruleOffer ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t bg-muted/40 px-4 py-2 text-sm" role="status">
            {notice ? <span>{notice}</span> : null}
            {ruleOffer ? (
              <>
                <span className="text-muted-foreground">
                  Saved. Always use <strong className="font-medium text-foreground">{moneyCategoryLabel(ruleOffer.category)}</strong> for “{ruleOffer.item.description}” in {ruleOffer.item.accountName}?
                </span>
                <Button type="button" size="sm" variant="outline" disabled={saving !== undefined} onClick={() => void categorize([ruleOffer.item], ruleOffer.category, true)}>Make it a rule</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setRuleOffer(undefined)}>No</Button>
              </>
            ) : null}
          </div>
        ) : null}
        <div className="border-t" role="region" aria-label="Transaction ledger">
          {rows.length ? (
            isMobile ? (
              <ul className="divide-y" aria-label="Transactions matching the current filters">
                {rows.map((item) => (
                  <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-4 py-2.5">
                    <div className="min-w-0">
                      <TransactionDescription className="text-sm font-medium" description={item.description || item.sourceType} />
                      <p className="truncate text-xs text-muted-foreground">{formatDay(item.occurredAt)} · {item.accountName}</p>
                    </div>
                    <strong className={`text-right text-sm font-semibold tabular-nums ${item.amountMinor > 0 ? "text-positive" : ""}`}>{formatMinor(item.amountMinor, { precise: true, signed: true })}</strong>
                    <div className="col-span-2 flex justify-end">{chip(item)}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="overflow-x-auto">
                <table className="money-table table-fixed" aria-label="Transaction detail table">
                  <colgroup>
                    <col style={{ width: "2.75rem" }} />
                    <col style={{ width: "6.5rem" }} />
                    <col />
                    <col style={{ width: "10rem" }} />
                    <col style={{ width: "12rem" }} />
                    <col style={{ width: "8.5rem" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th><span className="sr-only">Select</span></th>
                      <MoneySortableHead label="Date" sortKey="date" active={sort} onSort={changeSort} />
                      <MoneySortableHead label="Description" sortKey="description" active={sort} onSort={changeSort} />
                      <MoneySortableHead label="Account" sortKey="account" active={sort} onSort={changeSort} />
                      <MoneySortableHead label="Category" sortKey="category" active={sort} onSort={changeSort} />
                      <MoneySortableHead label="Amount" sortKey="amount" active={sort} onSort={changeSort} align="right" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((item) => (
                      <tr key={item.id} aria-selected={selectedRows.has(item.id)}>
                        <td>
                          <input type="checkbox" className="size-4 accent-[var(--primary)]" aria-label={`Select ${item.description}`} checked={selectedRows.has(item.id)} disabled={needsTransferTreatment(item)} onChange={() => toggleRow(item.id)} />
                        </td>
                        <td className="whitespace-nowrap text-muted-foreground tabular-nums">{formatDay(item.occurredAt)}</td>
                        <td className="min-w-0">
                          <TransactionDescription className="font-medium" description={item.description || item.sourceType} />
                          <span className="sub truncate">{item.sourceType}{item.transferGroupId ? " · matched transfer" : ""}{item.feeMinor + item.taxMinor ? ` · ${formatMinor(item.feeMinor + item.taxMinor, { precise: true })} costs` : ""}</span>
                        </td>
                        <td className="truncate text-muted-foreground" title={item.accountName}>{item.accountName}</td>
                        <td>{chip(item)}</td>
                        <td className={`num font-semibold ${item.amountMinor > 0 ? "text-positive" : ""}`}>{formatMinor(item.amountMinor, { precise: true, signed: true })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <EmptyState title={reviewOnly ? "Nothing to review" : transactionCount ? "No matching rows" : "No transactions imported"}>
              {reviewOnly ? "No rows that need review match these filters." : transactionCount ? "Change the search or a filter." : "Import a statement to fill the ledger."}
            </EmptyState>
          )}
          {hasMore ? (
            <div className="border-t p-3 text-center">
              <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void loadActivity(true)}>{loading ? "Loading…" : "Load 50 more"}</Button>
            </div>
          ) : null}
        </div>
      </MoneyPanel>
      {selectedItems.length ? (
        <div className="sticky bottom-4 z-30 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 rounded-full border bg-popover px-4 py-2 text-sm shadow-lg" role="region" aria-label="Selected rows">
          <strong className="font-semibold">{selectedItems.length} selected</strong>
          <MoneyCategoryPicker compact value="uncategorized" disabled={saving !== undefined} ariaLabel="Set a category for the selected rows" onValue={(next) => void categorize(selectedItems, next)} />
          <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedRows(new Set())}>Clear</Button>
        </div>
      ) : null}
    </div>
  );
}

function needsTransferTreatment(item: Activity) {
  return item.needsTransferReview;
}

/** Drop zone and batch import. Every page links here through its Import button. */
export function MoneyImportDrop({ lastImport }: { lastImport?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [files, setFiles] = useState<MoneyImportFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<"preview" | "commit">();
  const [progress, setProgress] = useState(0);
  const [operationTotal, setOperationTotal] = useState(0);
  const choose = (selected?: FileList | null) => {
    setFiles(Array.from(selected ?? []).map((file, index) => ({ id: `${file.name}:${file.size}:${file.lastModified}:${index}`, file })));
    setBusy(undefined);
    setProgress(0);
    setOperationTotal(0);
  };
  const updateFile = (id: string, update: Partial<Pick<MoneyImportFile, "preview" | "receipt" | "error">>) =>
    setFiles((current) => current.map((item) => (item.id === id ? { ...item, ...update } : item)));
  const clear = () => {
    setFiles([]);
    setProgress(0);
    setOperationTotal(0);
    if (input.current) input.current.value = "";
  };
  const previewFiles = async () => {
    const pending = files.filter((item) => !item.receipt);
    if (!pending.length) return;
    setBusy("preview");
    setProgress(0);
    setOperationTotal(pending.length);
    for (const [index, item] of pending.entries()) {
      updateFile(item.id, { preview: undefined, error: undefined });
      try {
        const form = new FormData();
        form.set("file", item.file);
        updateFile(item.id, { preview: await moneyForm<MoneyImportPreview>("/api/money/imports/preview", form), error: undefined });
      } catch (caught) {
        updateFile(item.id, { preview: undefined, error: message(caught) });
      }
      setProgress(index + 1);
    }
    setBusy(undefined);
  };
  const commitFiles = async () => {
    const ready = files.filter((item) => item.preview && !item.receipt);
    if (!ready.length) return;
    setBusy("commit");
    setProgress(0);
    setOperationTotal(ready.length);
    let imported = false;
    for (const [index, item] of ready.entries()) {
      if (!item.preview) continue;
      updateFile(item.id, { error: undefined });
      try {
        const form = new FormData();
        form.set("file", item.file);
        form.set("expectedDigest", item.preview.digest);
        updateFile(item.id, { receipt: await moneyForm<MoneyImportReceipt>("/api/money/imports", form), error: undefined });
        imported = true;
      } catch (caught) {
        updateFile(item.id, { error: message(caught) });
      }
      setProgress(index + 1);
    }
    setBusy(undefined);
    if (imported) await router.invalidate();
  };
  const readyCount = files.filter((item) => item.preview && !item.receipt).length;
  const completedCount = files.filter((item) => item.receipt).length;
  const pick = () => {
    if (!input.current) return;
    input.current.value = "";
    input.current.click();
  };
  return (
    <div className="grid gap-3">
      <input
        ref={input}
        className="sr-only"
        tabIndex={-1}
        type="file"
        multiple
        accept=".xlsx,.tsv,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/tab-separated-values,text/csv"
        disabled={busy !== undefined}
        onChange={(event) => choose(event.currentTarget.files)}
      />
      <div
        className={`flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-dashed px-4 py-3.5 transition-colors ${dragging ? "border-primary bg-secondary/60" : "border-control-border bg-card"}`}
        onDragEnter={(event) => { event.preventDefault(); if (busy) return; dragDepth.current += 1; setDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); if (!busy) event.dataTransfer.dropEffect = "copy"; }}
        onDragLeave={(event) => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (!busy && event.dataTransfer.files.length) choose(event.dataTransfer.files); }}
      >
        <FileSpreadsheet className="size-5 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-56 flex-1 text-sm">
          <p className="font-medium">{files.length ? `${files.length} file${files.length === 1 ? "" : "s"} selected` : dragging ? "Drop files to preview" : "Drop statements here"}</p>
          <p className="text-muted-foreground">
            {files.length ? formatBytes(files.reduce((total, item) => total + item.file.size, 0)) : `Sparkasse XLSX, Revolut cash or trading TSV, portfolio CSV, balance CSV, up to 10 MB each.${lastImport ? ` Last import ${lastImport}.` : ""}`}
          </p>
        </div>
        <Button type="button" variant="outline" disabled={busy !== undefined} onClick={pick}>
          <Upload />
          Choose files
        </Button>
      </div>
      {files.length ? (
        <BatchImportPanel
          files={files}
          busy={busy}
          progress={progress}
          operationTotal={operationTotal}
          readyCount={readyCount}
          completedCount={completedCount}
          onPreview={() => void previewFiles()}
          onCommit={() => void commitFiles()}
          onClear={clear}
          onRemove={(id) => setFiles((current) => current.filter((item) => item.id !== id))}
        />
      ) : null}
    </div>
  );
}

/** Import history with delete and rebuild. */
export function MoneyImportHistory({ imports }: Pick<MoneyTrackerPageData, "imports">) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string>();
  const [deleteError, setDeleteError] = useState<string>();
  const [reimporting, setReimporting] = useState(false);
  const [reimportError, setReimportError] = useState<string>();
  const [reimportResult, setReimportResult] = useState<{ importCount: number; transactionCount: number; linkedPairCount: number }>();
  const [reimportOpen, setReimportOpen] = useState(false);
  const reimportingRef = useRef(false);
  const deleteImport = async (importId: string) => {
    setDeleting(importId);
    setDeleteError(undefined);
    try {
      await moneyDelete(`/api/money/imports/${encodeURIComponent(importId)}`);
      await router.invalidate();
    } catch (caught) {
      setDeleteError(message(caught));
    } finally {
      setDeleting(undefined);
    }
  };
  const reimportAll = async () => {
    reimportingRef.current = true;
    setReimporting(true);
    setReimportError(undefined);
    setReimportResult(undefined);
    try {
      const result = await moneyJson<{ ok: true; importCount: number; transactionCount: number; linkedPairCount: number }>("/api/money/imports/reimport", {});
      await router.invalidate();
      setReimportResult(result);
    } catch (caught) {
      setReimportError(message(caught));
    } finally {
      reimportingRef.current = false;
      setReimporting(false);
    }
  };
  const changeReimportOpen = (open: boolean) => {
    if (reimportingRef.current) return;
    setReimportOpen(open);
    if (open) {
      setReimportError(undefined);
      setReimportResult(undefined);
    }
  };
  return (
    <MoneyPanel
      title="Import history"
      description="Deleting an import removes only the rows it added. Rebuild recalculates categories and transfer links from stored rows."
      actions={
        <AlertDialog open={reimportOpen} onOpenChange={changeReimportOpen}>
          <AlertDialogTrigger render={<Button type="button" size="sm" variant="outline" disabled={!imports.length || deleting !== undefined || reimporting} />}>
            <RefreshCw />
            Rebuild data
          </AlertDialogTrigger>
          <ReimportDialogContent reimporting={reimporting} result={reimportResult} error={reimportError} onRetry={() => void reimportAll()} />
        </AlertDialog>
      }
    >
      {deleteError ? (
        <Alert className="m-3 w-auto" variant="destructive">
          <AlertTitle>Import not deleted</AlertTitle>
          <AlertDescription>{deleteError}</AlertDescription>
        </Alert>
      ) : null}
      {reimportResult ? (
        <p className="mx-4 mt-3 text-sm text-positive" role="status">
          Rebuilt {reimportResult.transactionCount.toLocaleString("en-GB")} transactions from {reimportResult.importCount.toLocaleString("en-GB")} imports. {reimportResult.linkedPairCount.toLocaleString("en-GB")} transfer pairs linked.
        </p>
      ) : null}
      <div className="mt-2 overflow-x-auto">
        {imports.length ? (
          <table className="money-table" aria-label="Imports">
            <thead>
              <tr><th>File</th><th className="hide-sm">Imported</th><th className="num">New rows</th><th className="num hide-sm">Duplicates</th><th className="num"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {imports.map((item) => (
                <tr key={item.id}>
                  <td className="max-w-80">
                    <span className="block truncate font-medium" title={item.filename}>{item.filename}</span>
                    <span className="sub">{formatLabel(item.format)} · {formatBytes(item.bytes)}<span className="md:hidden"> · {formatDate(item.committedAt)}</span></span>
                  </td>
                  <td className="hide-sm whitespace-nowrap text-muted-foreground">{formatDate(item.committedAt)}</td>
                  <td className="num">{item.insertedCount.toLocaleString("en-GB")}</td>
                  <td className="num hide-sm text-muted-foreground">{item.duplicateCount.toLocaleString("en-GB")}</td>
                  <td className="num">
                    <AlertDialog>
                      <AlertDialogTrigger aria-label={`Delete ${item.filename}`} render={<Button type="button" variant="destructive-subtle" size="icon-sm" disabled={deleting !== undefined || reimporting} />}>
                        <Trash2 />
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete {item.filename}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This cannot be undone. The raw file is already discarded. {item.insertedCount.toLocaleString("en-GB")} transaction{item.insertedCount === 1 ? "" : "s"} and all derived investment events,
                            balance snapshots, and analytics owned by this import will be removed. Data from other imports will stay.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={deleting === item.id}>Cancel</AlertDialogCancel>
                          <AlertDialogAction variant="destructive" disabled={deleting === item.id} onClick={() => void deleteImport(item.id)}>
                            {deleting === item.id ? "Deleting…" : "Delete import data"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="No imports yet">Completed imports appear here with their row counts.</EmptyState>
        )}
      </div>
    </MoneyPanel>
  );
}

function ReimportDialogContent({
  reimporting,
  result,
  error,
  onRetry,
}: Readonly<{
  reimporting: boolean;
  result?: {
    importCount: number;
    transactionCount: number;
    linkedPairCount: number;
  };
  error?: string;
  onRetry: () => void;
}>) {
  if (reimporting)
    return (
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rebuilding imported data</AlertDialogTitle>
          <AlertDialogDescription role="status">
            Rebuilding categories and transfer links. Keep this window open
            until the result appears.
          </AlertDialogDescription>
        </AlertDialogHeader>
      </AlertDialogContent>
    );
  if (result)
    return (
      <AlertDialogContent>
        <AlertDialogHeader>
        <AlertDialogTitle>Rebuild complete</AlertDialogTitle>
          <AlertDialogDescription>
            {result.transactionCount.toLocaleString("en-GB")} stored
            transactions rebuilt across {result.importCount.toLocaleString("en-GB")} imports.{" "}
            {result.linkedPairCount.toLocaleString("en-GB")} transfer pairs
            linked.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    );
  if (error)
    return (
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rebuild failed</AlertDialogTitle>
          <AlertDialogDescription>{error}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
          <AlertDialogAction onClick={onRetry}>Try again</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    );
  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Rebuild imported data?</AlertDialogTitle>
        <AlertDialogDescription>
          This reapplies import inference to every stored transaction. Original
          upload files are not retained, so this does not reparse documents.
          Manual transaction categories and transfer review choices will be
          reset, then active category rules will be reapplied. Manual balance
          entries will stay.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={onRetry}>Rebuild data</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

const marketChartConfig = {
  marketValue: { label: "Market value" },
  costBasis: { label: "Cost basis" },
  movingAverage90: { label: "90-day average" },
} satisfies ChartConfig;

const benchmarkChartConfig = {
  actualIndex: { label: "Actual" },
  inflationIndex: { label: "Euro-area inflation" },
  targetIndex: { label: "7% annual target" },
} satisfies ChartConfig;

const MAX_PORTFOLIO_CHART_POINTS = 480;

export function MoneyInvestmentsView({
  investments,
  marketData,
  checkIn,
}: Pick<MoneyTrackerPageData, "investments" | "marketData" | "checkIn">) {
  const router = useRouter();
  const [period, setPeriod] = useState<"1y" | "5y" | "all">("1y");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();
  const [positionQuery, setPositionQuery] = useState("");
  const [positionClass, setPositionClass] = useState<"all" | "equity" | "etf" | "crypto">("all");
  const [positionSort, setPositionSort] = useState<MoneySort<PositionSortKey>>({ key: "value", direction: "desc" });
  const movesSince = useMemo(() => new Map(checkIn?.positions.map((move) => [move.canonicalKey, move])), [checkIn]);
  const cutoff = new Date(marketData.asOf);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - (period === "5y" ? 5 : 1));
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const history = useMemo(() => {
    const complete = marketData.history
      .filter((point) => point.complete)
      .map((point) => ({
        date: point.date,
        marketValue: point.knownMarketValueMinor / 100,
        costBasis: point.costBasisMinor / 100,
        inflationBenchmark: point.inflationBenchmarkMinor === undefined ? undefined : point.inflationBenchmarkMinor / 100,
        target7Percent: point.target7PercentMinor / 100,
      }));
    return portfolioMovingAverage(complete).filter((point) => period === "all" || point.date >= cutoffDate);
  }, [cutoffDate, marketData.history, period]);
  const chartHistory = useMemo(
    () => portfolioChartPoints(history, investments.trades.filter((item) => period === "all" || item.date >= cutoffDate)),
    [cutoffDate, history, investments.trades, period],
  );
  const priced = marketData.positions.filter((position) => position.marketValueMinor !== undefined);
  const needsPrice = marketData.positions.filter((position) => position.state !== "fresh").length;
  const priceDate = priced.flatMap((position) => (position.priceDate ? [position.priceDate] : [])).sort().at(-1);
  const total = priced.reduce((sum, position) => sum + (position.marketValueMinor ?? 0), 0);
  const allocation = (["etf", "equity", "crypto"] as const)
    .map((assetClass, index) => ({ assetClass, color: `var(--money-series-${index + 1})`, value: priced.filter((position) => position.assetClass === assetClass).reduce((sum, position) => sum + (position.marketValueMinor ?? 0), 0) }))
    .filter((item) => item.value > 0);
  const ranked = [...priced].sort((left, right) => (right.marketValueMinor ?? 0) - (left.marketValueMinor ?? 0));
  const largestValue = ranked[0]?.marketValueMinor ?? 1;
  const topThree = ranked.slice(0, 3).reduce((sum, position) => sum + (position.marketValueMinor ?? 0), 0);
  const latestBenchmark = history.at(-1);
  const aboveInflationMinor = latestBenchmark?.inflationBenchmark === undefined ? undefined : marketData.totals.knownMarketValueMinor - Math.round(latestBenchmark.inflationBenchmark * 100);
  const versusTargetMinor = latestBenchmark ? marketData.totals.knownMarketValueMinor - Math.round(latestBenchmark.target7Percent * 100) : undefined;
  const maxGain = Math.max(...marketData.positions.map((position) => Math.abs(position.unrealizedGainMinor ?? 0)), 1);
  const realized = investments.realized.totals;
  const visiblePositions = useMemo(() => {
    const normalized = positionQuery.trim().toLocaleLowerCase("en-GB");
    return marketData.positions
      .filter((position) => (positionClass === "all" || position.assetClass === positionClass) && (!normalized || `${position.name} ${position.providerKey ?? position.canonicalKey}`.toLocaleLowerCase("en-GB").includes(normalized)))
      .sort((left, right) => {
        const value = (position: typeof left) =>
          positionSort.key === "name" ? position.name
          : positionSort.key === "class" ? position.assetClass
          : positionSort.key === "quantity" ? Number(position.quantity)
          : positionSort.key === "close" ? (position.close ? Number(position.close) : undefined)
          : positionSort.key === "value" ? position.marketValueMinor
          : positionSort.key === "gain" ? position.unrealizedGainMinor
          : positionSort.key === "return" ? (position.unrealizedGainMinor === undefined || !position.costBasisMinor ? undefined : position.unrealizedGainMinor / position.costBasisMinor)
          : positionSort.key === "since" ? movesSince.get(position.canonicalKey)?.moveMinor
          : position.state;
        return compareMoneyValues(value(left), value(right), positionSort.direction) || left.name.localeCompare(right.name);
      });
  }, [marketData.positions, movesSince, positionClass, positionQuery, positionSort]);
  const changePositionSort = (key: PositionSortKey) => setPositionSort((current) => nextMoneySort(current, key, ["name", "class", "state"]));
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
  return (
    <div className="money-stack">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {marketData.positions.length.toLocaleString("en-GB")} positions{priceDate ? ` · prices from ${formatDay(priceDate)}` : ""}
          {needsPrice ? <span className="text-warning"> · {needsPrice} without a current price</span> : null}
        </p>
        <Button type="button" size="sm" variant="outline" disabled={refreshing} onClick={() => void refresh()}>
          <RefreshCw className={refreshing ? "opacity-50" : ""} />
          {refreshing ? "Refreshing…" : "Refresh prices"}
        </Button>
      </div>
      {refreshError ? (
        <Alert variant="destructive">
          <AlertTitle>Prices not refreshed</AlertTitle>
          <AlertDescription>{refreshError}. Cached prices stay in use.</AlertDescription>
        </Alert>
      ) : null}
      <StatStrip label="Portfolio summary">
        <Stat label="Market value" value={formatMinor(marketData.totals.knownMarketValueMinor)} detail={marketData.totals.complete ? "All positions priced" : "Priced positions only"} />
        <Stat label="Cost basis" value={formatMinor(marketData.totals.costBasisMinor)} detail="FIFO, with fees" />
        <Stat label="Unrealized" value={formatMinor(marketData.totals.knownUnrealizedGainMinor, { signed: true })} tone={marketData.totals.knownUnrealizedGainMinor} detail={gainPercent(marketData.totals.knownUnrealizedGainMinor, marketData.totals.costBasisMinor)} />
        <Stat label="Realized" value={formatMinor(realized.gainMinor, { signed: true })} tone={realized.gainMinor} detail={`${realized.saleCount.toLocaleString("en-GB")} matched sale${realized.saleCount === 1 ? "" : "s"}`} />
        <Stat label="Above inflation" value={aboveInflationMinor === undefined ? "—" : formatMinor(aboveInflationMinor, { signed: true })} tone={aboveInflationMinor} detail={aboveInflationMinor === undefined ? "Refresh to load euro-area inflation" : "Against the same deposits"} />
        <Stat label="Against 7% target" value={versusTargetMinor === undefined ? "—" : formatMinor(versusTargetMinor, { signed: true })} tone={versusTargetMinor} detail="Your planning target" />
      </StatStrip>
      <div className="money-grid money-grid--main">
        <MoneyPanel
          title="Value and cost"
          description="Daily closes. Dots are purchases and sales."
          actions={<Segmented label="Portfolio history range" value={period} onValue={setPeriod} options={[["1y", "1Y"], ["5y", "5Y"], ["all", "All"]]} />}
        >
          <PanelBody>
            {history.length ? (
              <>
                <Legend>
                  <LegendItem color={SERIES.primary} shape="line">Market value</LegendItem>
                  <LegendItem color={SERIES.muted} shape="dash">Cost basis</LegendItem>
                  <LegendItem color={SERIES.secondary} shape="line">90-day average</LegendItem>
                  <LegendItem color={SERIES.income} shape="dot">Purchase</LegendItem>
                  <LegendItem color={SERIES.spending} shape="dot">Sale</LegendItem>
                </Legend>
                <ChartContainer config={marketChartConfig} className="mt-2 h-[17rem] w-full aspect-auto" initialDimension={{ width: 760, height: 272 }} role="img" aria-label="Portfolio market value and FIFO cost basis in euro, with purchase and sale markers">
                  <AreaChartForPortfolio data={chartHistory} />
                </ChartContainer>
              </>
            ) : (
              <EmptyState title="No valuation history yet">Refresh prices once to load historical closing prices.</EmptyState>
            )}
          </PanelBody>
          {history.length ? (
            <>
              <details className="money-twin">
                <summary>Growth against inflation and the 7% target</summary>
                <div className="px-4 pb-4">
                  <p className="mb-2 text-xs text-muted-foreground">Index 100 is the remaining cost basis.</p>
                  <Legend>
                    <LegendItem color={SERIES.primary} shape="line">Portfolio</LegendItem>
                    <LegendItem color={SERIES.secondary} shape="line">Euro-area inflation</LegendItem>
                    <LegendItem color={SERIES.muted} shape="dash">7% per year</LegendItem>
                  </Legend>
                  <ChartContainer config={benchmarkChartConfig} className="mt-2 h-[11rem] w-full aspect-auto" initialDimension={{ width: 760, height: 176 }} role="img" aria-label="Portfolio growth compared with euro-area inflation and a seven percent annual target">
                    <PortfolioBenchmarkChart data={chartHistory} />
                  </ChartContainer>
                </div>
              </details>
              <PortfolioHistoryDisclosure history={history} />
            </>
          ) : null}
        </MoneyPanel>
        <MoneyPanel title="Allocation" description="Share of market value">
          <PanelBody>
            {allocation.length ? (
              <>
                <div className="mb-3 flex h-3.5 gap-0.5" aria-hidden="true">
                  {allocation.map((item) => <span key={item.assetClass} className="rounded-[4px]" style={{ flex: item.value, background: item.color }} />)}
                </div>
                <dl className="grid gap-1.5 text-sm">
                  {allocation.map((item) => (
                    <div key={item.assetClass} className="grid grid-cols-[minmax(0,1fr)_3.5rem_6rem] items-center gap-2">
                      <dt className="flex items-center gap-2"><i className="size-2.5 rounded-[3px]" style={{ background: item.color }} />{assetClassLabel(item.assetClass)}</dt>
                      <dd className="text-right text-muted-foreground tabular-nums">{formatRatio(item.value / total)}</dd>
                      <dd className="text-right tabular-nums">{formatMinor(item.value)}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <EmptyState title="No priced positions" />
            )}
          </PanelBody>
          {ranked.length ? (
            <PanelFooter>
              <span>Largest <b className="font-semibold text-foreground">{ranked[0]!.name} {formatRatio((ranked[0]!.marketValueMinor ?? 0) / total)}</b></span>
              <span>Top 3 <b className="font-semibold text-foreground">{formatRatio(topThree / total)}</b></span>
            </PanelFooter>
          ) : null}
        </MoneyPanel>
      </div>
      <MoneyPanel
        title="Positions"
        actions={
          <>
            {checkIn ? <MoneyCheckInPicker checkIn={checkIn} view="investments" /> : null}
            <MoneyTableSearch value={positionQuery} onValue={setPositionQuery} placeholder="Filter positions" className="sm:w-48" />
            <NativeSelect size="sm" value={positionClass} aria-label="Filter positions by asset class" onChange={(event) => setPositionClass(event.currentTarget.value as typeof positionClass)}>
              <NativeSelectOption value="all">All classes</NativeSelectOption>
              <NativeSelectOption value="etf">ETFs</NativeSelectOption>
              <NativeSelectOption value="equity">Stocks</NativeSelectOption>
              <NativeSelectOption value="crypto">Crypto</NativeSelectOption>
            </NativeSelect>
          </>
        }
      >
        <div className="mt-2 overflow-x-auto">
          <table className="money-table" aria-label="Portfolio positions">
            <thead>
              <tr>
                <MoneySortableHead label="Instrument" sortKey="name" active={positionSort} onSort={changePositionSort} />
                <MoneySortableHead label="Quantity" sortKey="quantity" active={positionSort} onSort={changePositionSort} align="right" className="hide-sm" />
                <MoneySortableHead label="Price" sortKey="close" active={positionSort} onSort={changePositionSort} align="right" className="hide-sm" />
                <MoneySortableHead label="Value" sortKey="value" active={positionSort} onSort={changePositionSort} align="right" />
                <th className="hide-sm w-[13%]">Weight</th>
                {checkIn ? <MoneySortableHead label={`Since ${formatDay(checkIn.baseline)}`} sortKey="since" active={positionSort} onSort={changePositionSort} align="right" className="hide-sm" /> : null}
                <MoneySortableHead label="Gain" sortKey="gain" active={positionSort} onSort={changePositionSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {visiblePositions.map((position) => {
                const move = movesSince.get(position.canonicalKey);
                return (
                  <tr key={position.canonicalKey}>
                    <td>
                      <span className="font-medium">{position.name}</span>
                      {position.state !== "fresh" ? <Badge variant="outline" className="ml-2 text-warning">{position.state === "unpriced" ? "No price" : `Price from ${position.priceDate ? formatDay(position.priceDate) : "earlier"}`}</Badge> : null}
                      <span className="sub">{assetClassLabel(position.assetClass)} · {position.providerKey ?? position.canonicalKey} · cost {formatMinor(position.costBasisMinor)}</span>
                    </td>
                    <td className="num hide-sm">{Number(position.quantity).toLocaleString("de-DE", { maximumFractionDigits: 4 })}</td>
                    <td className="num hide-sm">{position.close && position.currency ? decimalMoney(position.close, position.currency) : "—"}</td>
                    <td className="num font-semibold">
                      {position.marketValueMinor === undefined ? "—" : formatMinor(position.marketValueMinor)}
                      {position.marketValueMinor !== undefined && total ? <span className="sub md:hidden">{formatRatio(position.marketValueMinor / total)}</span> : null}
                    </td>
                    <td className="hide-sm">
                      {position.marketValueMinor === undefined ? null : (
                        <span className="flex items-center gap-2">
                          <ShareBar ratio={position.marketValueMinor / largestValue} className="flex-1" />
                          <span className="w-11 text-right text-xs text-muted-foreground tabular-nums">{formatRatio(position.marketValueMinor / total)}</span>
                        </span>
                      )}
                    </td>
                    {checkIn ? (
                      <td className={`num hide-sm ${move ? toneClass(move.moveMinor) : "text-muted-foreground"}`}>
                        {move ? formatMinor(move.moveMinor, { signed: true }) : "—"}
                        {move?.returnPercent === undefined ? null : <span className="sub">{formatPercent(move.returnPercent)}</span>}
                      </td>
                    ) : null}
                    <td className="num">
                      {position.unrealizedGainMinor === undefined ? "—" : (
                        <span className="flex items-center justify-end gap-3">
                          <DivergingBar value={position.unrealizedGainMinor} maximum={maxGain} className="hidden w-20 md:block" />
                          <span className={toneClass(position.unrealizedGainMinor)}>
                            {formatMinor(position.unrealizedGainMinor, { signed: true })}
                            <span className="sub">{gainPercent(position.unrealizedGainMinor, position.costBasisMinor)}</span>
                          </span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visiblePositions.length ? null : <EmptyState title={marketData.positions.length ? "No positions match this filter" : "No open positions"}>{marketData.positions.length ? undefined : "Import a trading statement or portfolio CSV."}</EmptyState>}
        </div>
        <InvestmentActivityHistory investments={investments} />
      </MoneyPanel>
    </div>
  );
}

function assetClassLabel(assetClass: string) {
  return assetClass === "etf" ? "ETFs" : assetClass === "equity" ? "Stocks" : assetClass === "crypto" ? "Crypto" : assetClass;
}

type PortfolioChartPoint = Readonly<{
  date: string;
  marketValue: number;
  costBasis: number;
  movingAverage90: number;
  inflationBenchmark?: number;
  target7Percent: number;
  buyMarker?: number;
  sellMarker?: number;
  trades: MoneyTrackerPageData["investments"]["trades"];
}>;

type PortfolioHistoryPoint = Readonly<{
  date: string;
  marketValue: number;
  costBasis: number;
  movingAverage90?: number;
  inflationBenchmark?: number;
  target7Percent?: number;
}>;

type PortfolioMovingAverageInput = Readonly<{
  date: string;
  marketValue: number;
  costBasis: number;
  inflationBenchmark?: number;
  target7Percent: number;
}>;

type PortfolioMovingAveragePoint = PortfolioMovingAverageInput & Readonly<{ movingAverage90: number }>;

/** Adds a trailing 90-calendar-day market-value average without losing pre-range context. */
export function portfolioMovingAverage(history: readonly PortfolioMovingAverageInput[]): readonly PortfolioMovingAveragePoint[] {
  let first = 0;
  let sum = 0;
  return history.map((point, index) => {
    sum += point.marketValue;
    const threshold = new Date(`${point.date}T00:00:00Z`);
    threshold.setUTCDate(threshold.getUTCDate() - 89);
    const thresholdDate = threshold.toISOString().slice(0, 10);
    while (history[first] && history[first]!.date < thresholdDate) sum -= history[first++]!.marketValue;
    return { ...point, movingAverage90: sum / (index - first + 1) };
  });
}

/** Bounds SVG work while retaining endpoints, cost-basis changes, and trade markers. */
export function portfolioChartPoints(
  history: readonly PortfolioHistoryPoint[],
  trades: MoneyTrackerPageData["investments"]["trades"],
): readonly PortfolioChartPoint[] {
  const tradesByIndex = new Map<number, typeof trades>();
  for (const trade of trades) {
    const nextIndex = firstPointOnOrAfter(history, trade.date);
    const index =
      nextIndex < history.length
        ? nextIndex
        : trade.eventKind === "sell"
          ? history.length - 1
          : -1;
    if (index < 0) continue;
    tradesByIndex.set(index, [...(tradesByIndex.get(index) ?? []), trade]);
  }

  const requiredIndexes = new Set<number>([0, history.length - 1]);
  for (const index of tradesByIndex.keys()) requiredIndexes.add(index);
  for (let index = 1; index < history.length; index += 1) {
    if (history[index]!.costBasis !== history[index - 1]!.costBasis) {
      requiredIndexes.add(index - 1);
      requiredIndexes.add(index);
    }
  }

  const indexes = sampledIndexes(history.length, requiredIndexes);
  return indexes.map((index) => {
    const point = history[index]!;
    const pointTrades = tradesByIndex.get(index) ?? [];
    const hasBuy = pointTrades.some((trade) => trade.eventKind === "buy");
    const hasSell = pointTrades.some((trade) => trade.eventKind === "sell");
    const bothKinds = hasBuy && hasSell;
    return {
      ...point,
      movingAverage90: point.movingAverage90 ?? point.marketValue,
      target7Percent: point.target7Percent ?? point.costBasis,
      trades: pointTrades,
      buyMarker: hasBuy ? point.marketValue * (bothKinds ? 0.995 : 1) : undefined,
      sellMarker: hasSell
        ? point.marketValue * (bothKinds ? 1.005 : 1)
        : undefined,
    };
  });
}

function firstPointOnOrAfter(
  history: readonly PortfolioHistoryPoint[],
  date: string,
) {
  let low = 0;
  let high = history.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (history[middle]!.date < date) low = middle + 1;
    else high = middle;
  }
  return low;
}

function sampledIndexes(length: number, requiredIndexes: ReadonlySet<number>) {
  if (length <= MAX_PORTFOLIO_CHART_POINTS) {
    return Array.from({ length }, (_, index) => index);
  }

  const indexes = new Set(requiredIndexes);
  const sampleCount = Math.max(
    0,
    MAX_PORTFOLIO_CHART_POINTS - indexes.size,
  );
  for (let sample = 1; sample <= sampleCount; sample += 1) {
    indexes.add(Math.round((sample * (length - 1)) / (sampleCount + 1)));
  }
  return [...indexes].filter((index) => index >= 0).sort((a, b) => a - b);
}

const AreaChartForPortfolio = memo(function AreaChartForPortfolio({
  data,
}: {
  data: readonly PortfolioChartPoint[];
}) {
  return (
    <ComposedChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
      <defs>
        <linearGradient
          id="money-market-value-fill"
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop offset="5%" stopColor="var(--money-series-1)" stopOpacity={0.24} />
          <stop offset="95%" stopColor="var(--money-series-1)" stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <CartesianGrid vertical={false} />
      <XAxis
        dataKey="date"
        tickLine={false}
        axisLine={false}
        tickMargin={10}
        minTickGap={28}
        tickFormatter={(value: string) => formatDay(value, true)}
      />
      <YAxis
        tickLine={false}
        axisLine={false}
        width={74}
        tickFormatter={(value: number) => compactEuro(value)}
      />
      <ChartTooltip content={PortfolioChartTooltip} />
      <Area
        dataKey="marketValue"
        name="Market value"
        type="monotone"
        fill="url(#money-market-value-fill)"
        stroke="var(--money-series-1)"
        strokeWidth={2}
        isAnimationActive={false}
      />
      <Line
        dataKey="costBasis"
        name="Cost basis"
        type="stepAfter"
        stroke="var(--muted-foreground)"
        strokeWidth={1.5}
        strokeDasharray="6 5"
        dot={false}
        isAnimationActive={false}
      />
      <Line
        dataKey="movingAverage90"
        name="90-day average"
        type="monotone"
        stroke="var(--money-series-2)"
        strokeWidth={1.5}
        dot={false}
        isAnimationActive={false}
      />
      <Scatter
        dataKey="buyMarker"
        name="Purchase"
        fill="var(--positive)"
        stroke="var(--card)"
        strokeWidth={2}
        r={5}
        isAnimationActive={false}
      />
      <Scatter
        dataKey="sellMarker"
        name="Sale"
        fill="var(--negative)"
        stroke="var(--card)"
        strokeWidth={2}
        r={5}
        isAnimationActive={false}
      />
    </ComposedChart>
  );
});

function PortfolioChartTooltip({
  active,
  payload,
  label,
}: TooltipContentProps<TooltipValueType, string | number>) {
  const point = payload?.find((item) => item.payload)?.payload as
    PortfolioChartPoint | undefined;
  if (!active || !point) return null;
  return (
    <div className="min-w-52 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-xl">
      <strong className="block text-sm">{String(label ?? point.date)}</strong>
      <div className="mt-2 space-y-1 text-muted-foreground">
        <p className="flex justify-between gap-6">
          <span>Market value</span>
          <strong className="font-mono text-foreground">
            {preciseEuro(point.marketValue)}
          </strong>
        </p>
        <p className="flex justify-between gap-6">
          <span>90-day average</span>
          <strong className="font-mono text-foreground">{preciseEuro(point.movingAverage90)}</strong>
        </p>
        <p className="flex justify-between gap-6">
          <span>FIFO basis</span>
          <strong className="font-mono text-foreground">
            {preciseEuro(point.costBasis)}
          </strong>
        </p>
      </div>
      {point.trades.length ? (
        <div className="mt-2 space-y-2 border-t pt-2">
          {point.trades.map((trade, index) => (
            <div key={`${trade.eventKind}:${trade.symbol}:${index}`}>
              <strong
                className={
                  trade.eventKind === "buy"
                    ? "text-positive"
                    : "text-negative"
                }
              >
                {trade.eventKind === "buy" ? "Purchase" : "Sale"} ·{" "}
                {trade.symbol}
              </strong>
              <p className="text-muted-foreground">
                {trade.date} · {trade.quantity} units ·{" "}
                {money(trade.amountMinor, trade.currency)}
                {trade.feeMinor
                  ? ` · ${money(trade.feeMinor, trade.currency)} fee`
                  : ""}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const PortfolioBenchmarkChart = memo(function PortfolioBenchmarkChart({ data }: { data: readonly PortfolioChartPoint[] }) {
  const indexed = data.map((point) => ({
    date: point.date,
    actualIndex: point.costBasis ? (point.marketValue / point.costBasis) * 100 : undefined,
    inflationIndex: point.costBasis && point.inflationBenchmark !== undefined ? (point.inflationBenchmark / point.costBasis) * 100 : undefined,
    targetIndex: point.costBasis ? (point.target7Percent / point.costBasis) * 100 : undefined,
  }));
  return (
    <ComposedChart data={indexed} margin={{ left: 4, right: 12, top: 8 }}>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} minTickGap={28} tickFormatter={(value: string) => formatDay(value, true)} />
      <YAxis tickLine={false} axisLine={false} width={74} tickFormatter={(value: number) => value.toFixed(0)} />
      <ChartTooltip content={<ChartTooltipContent formatter={(value) => `${Number(value).toFixed(1)}`} />} />
      <Line dataKey="actualIndex" name="Portfolio" type="monotone" stroke="var(--money-series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
      <Line dataKey="inflationIndex" name="Euro-area inflation" type="stepAfter" stroke="var(--money-series-2)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
      <Line dataKey="targetIndex" name="7% per year" type="monotone" stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="6 5" dot={false} isAnimationActive={false} />
    </ComposedChart>
  );
});

function PortfolioHistoryDisclosure({
  history,
}: {
  history: readonly { date: string; marketValue: number; costBasis: number }[];
}) {
  return (
    <TableTwin label="View portfolio values as a table">
      <div className="max-h-80 overflow-y-auto">
        <table className="money-table">
          <thead>
            <tr><th>Date</th><th className="num">Market value</th><th className="num">Cost basis</th></tr>
          </thead>
          <tbody>
            {[...history].reverse().map((point) => (
              <tr key={point.date}>
                <td>{formatDay(point.date, true)}</td>
                <td className="num">{formatEuro(point.marketValue, { precise: true })}</td>
                <td className="num">{formatEuro(point.costBasis, { precise: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TableTwin>
  );
}

function InvestmentActivityHistory({
  investments,
}: Pick<MoneyTrackerPageData, "investments">) {
  const { totals, positions, realized } = investments;
  const [realizedSort, setRealizedSort] = useState<MoneySort<RealizedSortKey>>({
    key: "gain",
    direction: "desc",
  });
  const [activitySort, setActivitySort] = useState<
    MoneySort<InvestmentActivitySortKey>
  >({ key: "bought", direction: "desc" });
  const sortedRealized = [...realized.positions].sort((left, right) => {
    const value = (item: typeof left) =>
      realizedSort.key === "asset"
        ? item.symbol
        : realizedSort.key === "sales"
          ? item.saleCount
          : realizedSort.key === "quantity"
            ? Number(item.soldQuantity)
            : realizedSort.key === "proceeds"
              ? item.proceedsMinor
              : realizedSort.key === "basis"
                ? item.costBasisMinor
                : realizedSort.key === "gain"
                  ? item.gainMinor
                  : item.costBasisMinor
                    ? (item.gainMinor / item.costBasisMinor) * 100
                    : undefined;
    return (
      compareMoneyValues(value(left), value(right), realizedSort.direction) ||
      left.symbol.localeCompare(right.symbol)
    );
  });
  const sortedPositions = [...positions].sort((left, right) => {
    const value = (item: typeof left) =>
      activitySort.key === "asset"
        ? item.symbol
        : activitySort.key === "class"
          ? item.assetClass
          : activitySort.key === "quantity"
            ? Number(item.quantity)
            : activitySort.key === "bought"
              ? item.boughtMinor
              : activitySort.key === "sold"
                ? item.soldMinor
                : activitySort.key === "income"
                  ? item.incomeMinor
                  : item.feesMinor + item.taxesMinor;
    return (
      compareMoneyValues(value(left), value(right), activitySort.direction) ||
      left.symbol.localeCompare(right.symbol)
    );
  });
  const changeRealizedSort = (key: RealizedSortKey) =>
    setRealizedSort((current) => nextMoneySort(current, key, ["asset"]));
  const changeActivitySort = (key: InvestmentActivitySortKey) =>
    setActivitySort((current) =>
      nextMoneySort(current, key, ["asset", "class"]),
    );
  return (
    <>
      <details className="money-twin">
        <summary>
          Realized gains · {realized.totals.saleCount.toLocaleString("en-GB")} matched sale{realized.totals.saleCount === 1 ? "" : "s"} · {formatMinor(realized.totals.gainMinor, { signed: true })}
        </summary>
        {realized.totals.unmatchedSaleCount ? (
          <p className="px-4 pb-2 text-sm text-warning" role="note">
            {realized.totals.unmatchedSaleCount.toLocaleString("en-GB")} sale{realized.totals.unmatchedSaleCount === 1 ? "" : "s"} could not be matched to an earlier purchase. Their proceeds are left out.
          </p>
        ) : null}
        <div className="overflow-x-auto">
          {realized.positions.length ? (
            <table className="money-table" aria-label="Realized investment gains table">
              <thead>
                <tr>
                  <MoneySortableHead label="Asset" sortKey="asset" active={realizedSort} onSort={changeRealizedSort} />
                  <MoneySortableHead label="Sales" sortKey="sales" active={realizedSort} onSort={changeRealizedSort} align="right" className="hide-sm" />
                  <MoneySortableHead label="Quantity sold" sortKey="quantity" active={realizedSort} onSort={changeRealizedSort} align="right" className="hide-sm" />
                  <MoneySortableHead label="Proceeds" sortKey="proceeds" active={realizedSort} onSort={changeRealizedSort} align="right" />
                  <MoneySortableHead label="FIFO basis" sortKey="basis" active={realizedSort} onSort={changeRealizedSort} align="right" className="hide-sm" />
                  <MoneySortableHead label="Gain" sortKey="gain" active={realizedSort} onSort={changeRealizedSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {sortedRealized.map((item) => (
                  <tr key={item.symbol}>
                    <td className="font-medium">{item.symbol}</td>
                    <td className="num hide-sm">{item.saleCount}</td>
                    <td className="num hide-sm">{item.soldQuantity}</td>
                    <td className="num">{formatMinor(item.proceedsMinor)}</td>
                    <td className="num hide-sm">{formatMinor(item.costBasisMinor)}</td>
                    <td className={`num ${toneClass(item.gainMinor)}`}>
                      {formatMinor(item.gainMinor, { signed: true })}
                      <span className="sub">{gainPercent(item.gainMinor, item.costBasisMinor)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="No realized gains yet">They appear after a sale is matched to earlier purchases.</EmptyState>
          )}
        </div>
      </details>
      <details className="money-twin">
        <summary>
          Trade totals by asset · {positions.length.toLocaleString("en-GB")} assets · {formatMinor(totals.feesMinor + totals.taxesMinor)} fees and taxes
        </summary>
        <div className="overflow-x-auto">
          {positions.length ? (
            <table className="money-table" aria-label="Trade-derived investment quantities table">
              <thead>
                <tr>
                  <MoneySortableHead label="Asset" sortKey="asset" active={activitySort} onSort={changeActivitySort} />
                  <MoneySortableHead label="Quantity" sortKey="quantity" active={activitySort} onSort={changeActivitySort} align="right" className="hide-sm" />
                  <MoneySortableHead label="Bought" sortKey="bought" active={activitySort} onSort={changeActivitySort} align="right" />
                  <MoneySortableHead label="Sold" sortKey="sold" active={activitySort} onSort={changeActivitySort} align="right" />
                  <MoneySortableHead label="Income" sortKey="income" active={activitySort} onSort={changeActivitySort} align="right" className="hide-sm" />
                  <MoneySortableHead label="Costs" sortKey="costs" active={activitySort} onSort={changeActivitySort} align="right" className="hide-sm" />
                </tr>
              </thead>
              <tbody>
                {sortedPositions.map((item, index) => (
                  <tr key={`${item.symbol}:${item.name ?? index}`}>
                    <td>
                      <span className="font-medium">{item.symbol}</span>
                      {item.name ? <span className="sub">{item.name}</span> : null}
                    </td>
                    <td className="num hide-sm">{item.quantity}</td>
                    <td className="num">{money(item.boughtMinor, item.currency)}</td>
                    <td className="num">{money(item.soldMinor, item.currency)}</td>
                    <td className="num hide-sm">{money(item.incomeMinor, item.currency)}</td>
                    <td className="num hide-sm">{money(item.feesMinor + item.taxesMinor, item.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="No investment events">Import a trading statement or portfolio CSV.</EmptyState>
          )}
        </div>
      </details>
    </>
  );
}

type MoneyImportFile = Readonly<{
  id: string;
  file: File;
  preview?: MoneyImportPreview;
  receipt?: MoneyImportReceipt;
  error?: string;
}>;

function BatchImportPanel({
  files,
  busy,
  progress,
  operationTotal,
  readyCount,
  completedCount,
  onPreview,
  onCommit,
  onClear,
  onRemove,
}: {
  files: readonly MoneyImportFile[];
  busy?: "preview" | "commit";
  progress: number;
  operationTotal: number;
  readyCount: number;
  completedCount: number;
  onPreview: () => void;
  onCommit: () => void;
  onClear: () => void;
  onRemove: (id: string) => void;
}) {
  const complete = completedCount === files.length;
  const operationPosition = Math.min(progress + 1, operationTotal);
  return (
    <div className="rounded-lg border bg-muted/20">
      <div className="divide-y">
        {files.map((item) => {
          const preview = item.preview;
          return (
            <div className="space-y-2 p-4" key={item.id}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="truncate text-sm" title={item.file.name}>
                      {item.file.name}
                    </strong>
                    {item.receipt ? (
                      <Badge variant="outline">
                        <Check />
                        {item.receipt.replay
                          ? "Already imported"
                          : `${item.receipt.insertedCount.toLocaleString("en-GB")} new`}
                      </Badge>
                    ) : preview ? (
                      <Badge variant="outline">Ready</Badge>
                    ) : item.error ? (
                      <Badge variant="destructive">Needs attention</Badge>
                    ) : (
                      <Badge variant="outline">Selected</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatBytes(item.file.size)}
                    {preview
                      ? ` · ${formatLabel(preview.format)} · ${preview.dateRange.from} to ${preview.dateRange.to} · ${preview.rowCount.toLocaleString("en-GB")} rows · ${preview.duplicateCount.toLocaleString("en-GB")} known duplicates${preview.investmentEventCount ? ` · ${preview.investmentEventCount.toLocaleString("en-GB")} investment events` : ""}`
                      : ""}
                  </p>
                </div>
                {busy === undefined && !item.receipt ? (
                  <button
                    type="button"
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => onRemove(item.id)}
                    aria-label={`Remove ${item.file.name}`}
                  >
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>
              {preview ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {preview.accounts.map((account) => (
                    <div
                      className="rounded-md border bg-background p-3"
                      key={account.externalRef}
                    >
                      <div className="flex justify-between gap-3">
                        <strong className="truncate text-xs">
                          {account.name}
                        </strong>
                        <span className="font-mono text-xs">
                          {account.endingBalanceMinor === undefined
                            ? "—"
                            : money(
                                account.endingBalanceMinor,
                                account.currency,
                              )}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {account.rowCount.toLocaleString("en-GB")} rows ·{" "}
                        {account.revertedCount} reverted ·{" "}
                        {reconciliationLabel(
                          preview,
                          account.reconciliationMismatchCount,
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
              {preview?.warnings.map((warning) => (
                <Alert key={warning}>
                  <AlertTitle>Review warning</AlertTitle>
                  <AlertDescription>{warning}</AlertDescription>
                </Alert>
              ))}
              {item.error ? (
                <p className="text-sm text-negative" role="alert">
                  {item.error}
                </p>
              ) : null}
              {item.receipt ? (
                <p className="text-xs text-muted-foreground">
                  {item.receipt.insertedCount.toLocaleString("en-GB")} rows
                  inserted and{" "}
                  {item.receipt.duplicateCount.toLocaleString("en-GB")}{" "}
                  duplicates skipped.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t p-4">
        <Button
          type="button"
          disabled={busy !== undefined || complete}
          onClick={readyCount ? onCommit : onPreview}
        >
          <Upload />
          {busy === "preview"
            ? `Previewing ${operationPosition} of ${operationTotal}…`
            : busy === "commit"
              ? `Importing ${operationPosition} of ${operationTotal}…`
              : readyCount
                ? `Import ${readyCount} file${readyCount === 1 ? "" : "s"}`
                : complete
                  ? "Import complete"
                  : `Preview ${files.length - completedCount} file${files.length - completedCount === 1 ? "" : "s"}`}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy !== undefined}
          onClick={onClear}
        >
          {complete ? "Choose more files" : "Clear"}
        </Button>
        {completedCount ? (
          <span className="text-xs text-muted-foreground" role="status">
            {completedCount} of {files.length} files imported
          </span>
        ) : null}
      </div>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">
        Files are committed one at a time. Every commit reparses and
        digest-checks the file; raw bytes are never retained.
      </p>
    </div>
  );
}
async function moneyForm<Result>(url: string, form: FormData): Promise<Result> {
  return moneyFetch<Result>(url, { body: form });
}
async function moneyJson<Result = { ok: true }>(
  url: string,
  value: Record<string, unknown>,
  method = "POST",
): Promise<Result> {
  return moneyFetch<Result>(url, {
    method,
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  });
}
async function moneyFetch<Result>(
  url: string,
  init: Pick<RequestInit, "body" | "headers" | "method">,
): Promise<Result> {
  const response = await fetch(url, { method: "POST", ...init });
  const body = (await response.json()) as { message?: unknown } | Result;
  if (!response.ok)
    throw new Error(
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : `Money request failed with status ${response.status}.`,
    );
  return body as Result;
}
async function moneyGet<Result>(url: string): Promise<Result> {
  const response = await fetch(url);
  const body = (await response.json()) as { message?: unknown } | Result;
  if (!response.ok)
    throw new Error(
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : `Money request failed with status ${response.status}.`,
    );
  return body as Result;
}
async function moneyDelete<Result = { ok: true }>(
  url: string,
): Promise<Result> {
  const response = await fetch(url, { method: "DELETE" });
  const body = (await response.json()) as { message?: unknown } | Result;
  if (!response.ok)
    throw new Error(
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : `Money request failed with status ${response.status}.`,
    );
  return body as Result;
}
function message(error: unknown) {
  return error instanceof Error ? error.message : "The money request failed.";
}
function TransactionDescription({
  className,
  description,
}: {
  className?: string;
  description: string;
}) {
  const label = (
    <p
      className={`min-w-0 truncate ${className ?? ""}`}
      tabIndex={0}
      title={description}
    >
      {description}
    </p>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={label} />
      <TooltipContent
        className="max-w-lg whitespace-normal break-words"
        side="top"
        align="start"
      >
        {description}
      </TooltipContent>
    </Tooltip>
  );
}
function money(minor: number, currency: string) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(
    minor / 100,
  );
}
function decimalMoney(value: string, currency: string) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    maximumFractionDigits: 4,
  }).format(Number(value));
}
function preciseEuro(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}
function compactEuro(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
function gainPercent(gainMinor: number, costBasisMinor: number) {
  return costBasisMinor
    ? `${gainMinor >= 0 ? "+" : ""}${((gainMinor / costBasisMinor) * 100).toFixed(1)}%`
    : "—";
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
}
function formatBytes(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function formatLabel(value: string) {
  return value.replace(/_v\d$/, "").replaceAll("_", " ");
}
function reconciliationLabel(
  preview: MoneyImportPreview,
  mismatchCount: number,
) {
  return preview.format !== REVOLUT_CASH_FORMAT &&
    preview.format !== SPARKASSE_CASH_FORMAT
    ? "no running balance to reconcile"
    : mismatchCount
      ? `${mismatchCount} mismatches`
      : "running balances reconciled";
}
