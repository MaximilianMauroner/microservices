"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Inbox, ListFilter, Search } from "lucide-react";
import type { MoneyTrackerPageData } from "../../platform/protected-data.js";
import { MONEY_CATEGORIES, type MoneyCategory } from "./money-enums.js";
import type { MoneyActivityPage, MoneyActivitySortKey } from "./money-repository.js";
import { MoneySortableHead, MoneyTableSearch, nextMoneySort, type MoneySort } from "./money-data-table.js";
import { MoneyCategoryPicker, moneyCategoryLabel } from "./money-category-picker.js";
import { isRuleCategorized } from "./money-category-rules.js";
import { moneyGet, moneyJson } from "./money-requests.js";
import {
  EmptyState,
  formatDay,
  formatMinor,
  toneClass,
  TransactionDescription,
  MoneyPanel,
  MoneyTable,
  MoneyTableBody,
  MoneyTableCell,
  MoneyTableHead,
  MoneyTableHeader,
  MoneyTableRow,
} from "./money-ui.js";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useIsMobile } from "@/components/ui/use-mobile";

type Activity = MoneyTrackerPageData["activity"][number];

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
  const [searchQuery, setSearchQuery] = useState("");
  const [account, setAccount] = useState("all");
  const [category, setCategory] = useState<"all" | MoneyCategory>(initialCategory ?? "all");
  const [sort, setSort] = useState<MoneySort<MoneyActivitySortKey>>({ key: "date", direction: "desc" });
  const [reviewOnly, setReviewOnly] = useState(initialReviewOnly);
  const [saving, setSaving] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(activity.length < transactionCount);
  const [resultTotal, setResultTotal] = useState(transactionCount);
  const [error, setError] = useState<string>();
  const [loadError, setLoadError] = useState<{ message: string; append: boolean }>();
  const [ruleOffer, setRuleOffer] = useState<Readonly<{ item: Activity; category: MoneyCategory }>>();
  const [notice, setNotice] = useState<string>();
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(() => new Set());
  const requestSequence = useRef(0);
  const reviewTotal = reviewCounts.uncategorized + reviewCounts.transfers;
  const parameters = useMemo(() => {
    const result = new URLSearchParams({ query: searchQuery, offset: "0", limit: "50", sort: sort.key, direction: sort.direction });
    if (account !== "all") result.set("accountId", account);
    if (category !== "all") result.set("category", category);
    if (initialFromMonth) result.set("fromMonth", initialFromMonth);
    if (initialToMonth) result.set("toMonth", initialToMonth);
    if (reviewOnly) result.set("review", "true");
    return result;
  }, [account, category, searchQuery, reviewOnly, sort, initialFromMonth, initialToMonth]);
  const loadedFilters = useRef(!initialCategory && !initialReviewOnly && !initialFromMonth && !initialToMonth ? parameters.toString() : undefined);
  const loadActivity = async (append = false) => {
    const request = ++requestSequence.current;
    setLoading(true);
    setLoadError(undefined);
    if (!append) setSelectedRows(new Set());
    try {
      const requestParameters = new URLSearchParams(parameters);
      requestParameters.set("offset", String(append ? rows.length : 0));
      const page = await moneyGet<MoneyActivityPage>(`/api/money/activity?${requestParameters}`);
      if (request !== requestSequence.current) return;
      loadedFilters.current = parameters.toString();
      setRows((current) => (append ? [...current, ...page.items] : [...page.items]));
      setResultTotal(page.total);
      setHasMore(page.hasMore);
    } catch (caught) {
      if (request === requestSequence.current) setLoadError({ message: message(caught), append });
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (query === searchQuery) return;
    const timeout = window.setTimeout(() => setSearchQuery(query), 150);
    return () => window.clearTimeout(timeout);
  }, [query, searchQuery]);
  useEffect(() => {
    if (loadedFilters.current === parameters.toString()) {
      setLoading(false);
      setLoadError(undefined);
      return;
    }
    void loadActivity();
    return () => { requestSequence.current += 1; };
  }, [parameters]);
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
      setRuleOffer(!createRule && single && isRuleCategorized(single) ? { item: single, category: next } : undefined);
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
  const resultsCurrent = loadedFilters.current === parameters.toString() && query === searchQuery;
  const selectedItems = resultsCurrent ? rows.filter((row) => selectedRows.has(row.id)) : [];
  const chip = (item: Activity) =>
    needsTransferTreatment(item) ? (
      <Link to="/money" search={{ view: "review" }} className="inline-flex h-7 max-md:min-h-11 items-center rounded-md border border-dashed border-control-border px-2 text-[.8125rem] text-muted-foreground hover:text-foreground">
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
      {loadError ? (
        <Alert variant="destructive">
          <AlertTitle>Transactions could not be loaded</AlertTitle>
          <AlertDescription>{loadError.message} <Button type="button" size="sm" variant="outline" onClick={() => void loadActivity(loadError.append)}>Retry</Button></AlertDescription>
        </Alert>
      ) : null}
      <MoneyPanel>
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3.5 pb-3">
          <MoneyTableSearch value={query} onValue={setQuery} placeholder="Search description or account" className="min-w-64 flex-1 sm:max-w-sm" />
          <NativeSelect size="sm" value={account} aria-label="Filter by account" onChange={(event) => setAccount(event.currentTarget.value)}>
            <NativeSelectOption value="all">All accounts</NativeSelectOption>
            {accounts.map((id) => <NativeSelectOption key={id} value={id}>{accountLabels[id] ?? id}</NativeSelectOption>)}
          </NativeSelect>
          <NativeSelect size="sm" value={category} aria-label="Filter by category" onChange={(event) => setCategory(event.currentTarget.value as typeof category)}>
            <NativeSelectOption value="all">All categories</NativeSelectOption>
            {MONEY_CATEGORIES.map((value) => <NativeSelectOption key={value} value={value}>{moneyCategoryLabel(value)}</NativeSelectOption>)}
          </NativeSelect>
          <Button type="button" size="sm" variant={reviewOnly ? "default" : "outline"} aria-pressed={reviewOnly} onClick={() => setReviewOnly((current) => !current)}>
            Needs review
            <ListFilter />
            {reviewTotal ? <span className="money-review-badge ml-0">{reviewTotal > 999 ? "999+" : reviewTotal}</span> : null}
          </Button>
          {isMobile ? (
            <NativeSelect size="sm" value={`${sort.key}:${sort.direction}`} aria-label="Sort transactions" onChange={(event) => {
              const [key, direction] = event.currentTarget.value.split(":") as [MoneyActivitySortKey, "asc" | "desc"];
              setSort({ key, direction });
            }}>
              {(["date", "description", "account", "category", "amount"] as const).flatMap((key) => (["asc", "desc"] as const).map((direction) => (
                <NativeSelectOption key={`${key}:${direction}`} value={`${key}:${direction}`}>{key[0]!.toUpperCase() + key.slice(1)} · {direction === "asc" ? "ascending" : "descending"}</NativeSelectOption>
              )))}
            </NativeSelect>
          ) : null}
          <span className="ml-auto text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {!resultsCurrent ? (loadError ? "" : "Searching…") : loading ? "Loading…" : `${resultTotal.toLocaleString("en-GB")} rows`}
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
          {!resultsCurrent ? null : rows.length ? (
            isMobile ? (
              <ul className="divide-y" aria-label="Transactions matching the current filters">
                {rows.map((item) => (
                  <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-4 py-2.5">
                    <div className="min-w-0">
                      <TransactionDescription className="text-sm font-medium" description={item.description} sourceType={item.sourceType} />
                      <p className="truncate text-xs text-muted-foreground">{formatDay(item.occurredAt)} · {item.accountName}</p>
                    </div>
                    <strong className={`text-right text-sm font-semibold tabular-nums ${toneClass(item.amountMinor)}`}>{formatMinor(item.amountMinor, { precise: true, signed: true })}</strong>
                    <div className="col-span-2 flex items-center justify-between gap-2">
                      <label className="inline-flex min-h-11 items-center gap-2 text-sm">
                        <Checkbox aria-label={`Select ${item.description}`} checked={selectedRows.has(item.id)} disabled={needsTransferTreatment(item)} onCheckedChange={() => toggleRow(item.id)} />
                        Select
                      </label>
                      {chip(item)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="overflow-x-auto">
                <MoneyTable className="min-w-[52rem] table-fixed" aria-label="Transaction detail table">
                  <colgroup>
                    <col style={{ width: "2.75rem" }} />
                    <col style={{ width: "6.5rem" }} />
                    <col />
                    <col style={{ width: "10rem" }} />
                    <col style={{ width: "12rem" }} />
                    <col style={{ width: "8.5rem" }} />
                  </colgroup>
                  <MoneyTableHeader>
                    <MoneyTableRow>
                      <MoneyTableHead><span className="sr-only">Select</span></MoneyTableHead>
                      <MoneySortableHead label="Date" sortKey="date" active={sort} onSort={changeSort} />
                      <MoneySortableHead label="Description" sortKey="description" active={sort} onSort={changeSort} />
                      <MoneySortableHead label="Account" sortKey="account" active={sort} onSort={changeSort} />
                      <MoneySortableHead label="Category" sortKey="category" active={sort} onSort={changeSort} />
                      <MoneySortableHead label="Amount" sortKey="amount" active={sort} onSort={changeSort} align="right" />
                    </MoneyTableRow>
                  </MoneyTableHeader>
                  <MoneyTableBody>
                    {rows.map((item) => (
                      <MoneyTableRow key={item.id} aria-selected={selectedRows.has(item.id)}>
                        <MoneyTableCell>
                          <Checkbox aria-label={`Select ${item.description}`} checked={selectedRows.has(item.id)} disabled={needsTransferTreatment(item)} onCheckedChange={() => toggleRow(item.id)} />
                        </MoneyTableCell>
                        <MoneyTableCell className="whitespace-nowrap text-muted-foreground tabular-nums">{formatDay(item.occurredAt)}</MoneyTableCell>
                        <MoneyTableCell className="min-w-0">
                          <TransactionDescription className="font-medium" description={item.description} sourceType={item.sourceType} />
                          <span className="sub truncate">{item.sourceType}{item.transferGroupId ? " · matched transfer" : ""}{item.feeMinor + item.taxMinor ? ` · ${formatMinor(item.feeMinor + item.taxMinor, { precise: true })} costs` : ""}</span>
                        </MoneyTableCell>
                        <MoneyTableCell className="truncate text-muted-foreground" title={item.accountName}>{item.accountName}</MoneyTableCell>
                        <MoneyTableCell>{chip(item)}</MoneyTableCell>
                        <MoneyTableCell className={`num font-semibold ${toneClass(item.amountMinor)}`}>{formatMinor(item.amountMinor, { precise: true, signed: true })}</MoneyTableCell>
                      </MoneyTableRow>
                    ))}
                  </MoneyTableBody>
                </MoneyTable>
              </div>
            )
          ) : (
            <EmptyState
              title={reviewOnly ? "Nothing to review" : transactionCount ? "No matching rows" : "No transactions imported"}
              icon={reviewOnly ? <Inbox /> : <Search />}
            >
              {reviewOnly ? "No rows that need review match these filters." : transactionCount ? "Change the search or a filter." : "Import a statement to fill the ledger."}
            </EmptyState>
          )}
          {resultsCurrent && hasMore ? (
            <div className="border-t p-3 text-center">
              <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void loadActivity(true)}>{loading ? "Loading…" : "Load 50 more"}</Button>
            </div>
          ) : null}
        </div>
      </MoneyPanel>
      {selectedItems.length ? (
        <div className="sticky bottom-4 z-30 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 rounded-lg border bg-popover px-4 py-2 text-sm shadow-lg" role="region" aria-label="Selected rows">
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

function message(error: unknown) {
  return error instanceof Error ? error.message : "The money request failed.";
}
