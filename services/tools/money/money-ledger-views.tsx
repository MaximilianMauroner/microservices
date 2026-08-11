"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
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
} from "recharts";
import type { MoneyTrackerPageData } from "../src/protected-data.js";
import type { MoneyImportPreview } from "./money-import-domain.js";
import {
  MONEY_CATEGORIES,
  MONEY_TRANSFER_DISPOSITIONS,
  REVOLUT_CASH_FORMAT,
  SPARKASSE_CASH_FORMAT,
  type MoneyCategory,
  type MoneyTransferDisposition,
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
import {
  MONEY_ROW_ACTION_CLASS,
  MoneyRowActionCue,
} from "./money-row-action.js";
import { MoneyCategoryPicker } from "./money-category-picker.js";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../src/components/ui/card.js";
import { Input } from "../src/components/ui/input.js";
import { useIsMobile } from "../src/components/ui/use-mobile.js";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "../src/components/ui/chart.js";

type Activity = MoneyTrackerPageData["activity"][number];
type TransferSortKey = "description" | "account" | "count" | "total";
type PositionSortKey =
  | "name"
  | "class"
  | "quantity"
  | "close"
  | "value"
  | "gain"
  | "return"
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
  revertedCount,
  spending,
  transferReview,
  transferReviewGroups,
  initialCategory,
  initialReviewOnly = false,
}: Pick<
  MoneyTrackerPageData,
  | "activity"
  | "transactionCount"
  | "revertedCount"
  | "transferReview"
  | "transferReviewGroups"
> &
  Partial<
    Pick<MoneyTrackerPageData, "accounts" | "accountLabels" | "spending">
  > & { initialCategory?: MoneyCategory; initialReviewOnly?: boolean }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [rows, setRows] = useState(activity);
  const [query, setQuery] = useState("");
  const [flow, setFlow] = useState<"all" | Activity["flowKind"]>("all");
  const [account, setAccount] = useState("all");
  const [category, setCategory] = useState<"all" | MoneyCategory>(
    initialCategory ?? "all",
  );
  const [sort, setSort] = useState<MoneySort<MoneyActivitySortKey>>({
    key: "date",
    direction: "desc",
  });
  const [transferQuery, setTransferQuery] = useState("");
  const [transferSort, setTransferSort] = useState<MoneySort<TransferSortKey>>({
    key: "count",
    direction: "desc",
  });
  const [selectedTransferGroupId, setSelectedTransferGroupId] = useState(
    initialReviewOnly ? transferReviewGroups[0]?.representativeId : undefined,
  );
  const [selectedTransferRows, setSelectedTransferRows] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkDisposition, setBulkDisposition] =
    useState<MoneyTransferDisposition | "">("");
  const [reviewOnly, setReviewOnly] = useState(initialReviewOnly);
  const [saving, setSaving] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(activity.length < transactionCount);
  const [resultTotal, setResultTotal] = useState(transactionCount);
  const [error, setError] = useState<string>();
  const [ruleCandidate, setRuleCandidate] = useState<Activity>();
  const [ruleAffected, setRuleAffected] = useState<number>();
  const [mobileLimit, setMobileLimit] = useState(50);
  const requestSequence = useRef(0);
  const transferSelectionAnchor = useRef<number | undefined>(undefined);
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("en-GB");
    return rows.filter(
      (item) =>
        (!reviewOnly || item.needsTransferReview) &&
        (flow === "all" || item.flowKind === flow) &&
        (account === "all" || item.accountId === account) &&
        (category === "all" || item.category === category) &&
        (!normalized ||
          `${item.description} ${item.accountName} ${item.sourceType}`
            .toLocaleLowerCase("en-GB")
            .includes(normalized)),
    );
  }, [account, category, rows, flow, query, reviewOnly]);
  const renderedRows = isMobile ? visible.slice(0, mobileLimit) : visible;
  useEffect(
    () => setMobileLimit(50),
    [account, category, flow, query, reviewOnly, sort],
  );
  const categorize = async (
    item: Activity,
    category: MoneyCategory,
    createRule = false,
  ) => {
    setSaving(item.id);
    setError(undefined);
    try {
      const result = await moneyJson<{ ok: true; affectedCount: number }>(
        "/api/money/categories",
        { transactionId: item.id, category, createRule },
      );
      setRows((current) =>
        current.map((row) =>
          row.id === item.id
            ? { ...row, category, categoryOrigin: "manual" }
            : row,
        ),
      );
      setRuleCandidate(
        createRule
          ? undefined
          : { ...item, category, categoryOrigin: "manual" },
      );
      setRuleAffected(createRule ? result.affectedCount : undefined);
      await router.invalidate();
      await loadActivity(reviewOnly);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setSaving(undefined);
    }
  };
  const loadActivity = async (review: boolean, append = false) => {
    const request = ++requestSequence.current;
    setLoading(true);
    setError(undefined);
    try {
      const offset = append ? rows.length : 0;
      const parameters = new URLSearchParams({
        query,
        offset: String(offset),
        limit: "50",
      });
      if (flow !== "all") parameters.set("flow", flow);
      if (account !== "all") parameters.set("accountId", account);
      if (category !== "all") parameters.set("category", category);
      parameters.set("sort", sort.key);
      parameters.set("direction", sort.direction);
      if (review) parameters.set("review", "true");
      const page = await moneyGet<MoneyActivityPage>(
        `/api/money/activity?${parameters}`,
      );
      if (request !== requestSequence.current) return;
      setRows((current) =>
        append ? [...current, ...page.items] : [...page.items],
      );
      setResultTotal(page.total);
      setHasMore(page.hasMore);
    } catch (caught) {
      if (request === requestSequence.current) setError(message(caught));
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  };
  const searchAll = (append = false) => loadActivity(reviewOnly, append);
  useEffect(() => {
    const timeout = window.setTimeout(() => void loadActivity(reviewOnly), 300);
    return () => {
      window.clearTimeout(timeout);
      requestSequence.current += 1;
    };
  }, [account, category, flow, query, reviewOnly, sort]);
  const changeSort = (key: MoneyActivitySortKey) =>
    setSort((current) =>
      nextMoneySort(current, key, [
        "description",
        "account",
        "flow",
        "category",
      ]),
    );
  const visibleTransferGroups = useMemo(() => {
    const normalized = transferQuery.trim().toLocaleLowerCase("en-GB");
    return transferReviewGroups
      .filter(
        (group) =>
          !normalized ||
          `${group.description} ${group.accountName} ${group.sourceType}`
            .toLocaleLowerCase("en-GB")
            .includes(normalized),
      )
      .sort((left, right) => {
        const leftValue =
          transferSort.key === "description"
            ? left.description
            : transferSort.key === "account"
              ? left.accountName
              : transferSort.key === "count"
                ? left.count
                : left.totalMinor;
        const rightValue =
          transferSort.key === "description"
            ? right.description
            : transferSort.key === "account"
              ? right.accountName
              : transferSort.key === "count"
                ? right.count
                : right.totalMinor;
        return (
          compareMoneyValues(leftValue, rightValue, transferSort.direction) ||
          left.description.localeCompare(right.description)
        );
      });
  }, [transferQuery, transferReviewGroups, transferSort]);
  const changeTransferSort = (key: TransferSortKey) =>
    setTransferSort((current) =>
      nextMoneySort(current, key, ["description", "account"]),
    );
  const selectedTransferGroup = transferReviewGroups.find(
    (group) => group.representativeId === selectedTransferGroupId,
  );
  useEffect(() => {
    if (selectedTransferGroupId && !selectedTransferGroup) {
      setSelectedTransferGroupId(undefined);
      setSelectedTransferRows(new Set());
      transferSelectionAnchor.current = undefined;
    }
  }, [selectedTransferGroup, selectedTransferGroupId]);
  const toggleReview = () => {
    setReviewOnly((current) => {
      const next = !current;
      if (next && !selectedTransferGroupId) {
        setSelectedTransferGroupId(transferReviewGroups[0]?.representativeId);
      }
      return next;
    });
  };
  const openTransferGroup = (representativeId: string) => {
    setSelectedTransferGroupId(representativeId);
    setSelectedTransferRows(new Set());
    setBulkDisposition("");
    transferSelectionAnchor.current = undefined;
  };
  const toggleTransferRow = (
    itemId: string,
    index: number,
    checked: boolean,
    selectRange: boolean,
  ) => {
    setSelectedTransferRows((current) => {
      const next = new Set(current);
      const anchor = transferSelectionAnchor.current;
      if (selectRange && anchor !== undefined && selectedTransferGroup) {
        const start = Math.min(anchor, index);
        const end = Math.max(anchor, index);
        for (const item of selectedTransferGroup.items.slice(start, end + 1)) {
          if (checked) next.add(item.id);
          else next.delete(item.id);
        }
      } else if (checked) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
    transferSelectionAnchor.current = index;
  };
  const toggleAllTransferRows = (checked: boolean) => {
    setSelectedTransferRows(
      checked && selectedTransferGroup
        ? new Set(selectedTransferGroup.items.map((item) => item.id))
        : new Set(),
    );
    transferSelectionAnchor.current = undefined;
  };
  const applyBulkDisposition = async () => {
    if (!bulkDisposition || selectedTransferRows.size === 0) return;
    setSaving("bulk-transfer-treatment");
    setError(undefined);
    try {
      await moneyJson<{ ok: true; affectedCount: number }>(
        "/api/money/transfers",
        {
          transactionIds: [...selectedTransferRows],
          disposition: bulkDisposition,
        },
      );
      setSelectedTransferRows(new Set());
      setBulkDisposition("");
      transferSelectionAnchor.current = undefined;
      await Promise.all([loadActivity(reviewOnly), router.invalidate()]);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setSaving(undefined);
    }
  };
  const selectedTransferTotal = selectedTransferGroup?.items.reduce(
    (total, item) =>
      selectedTransferRows.has(item.id) ? total + item.amountMinor : total,
    0,
  ) ?? 0;
  return (
    <>
      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Activity summary"
      >
        <LedgerMetric
          label="Imported transactions"
          value={transactionCount.toLocaleString("en-GB")}
          detail={`${revertedCount.toLocaleString("en-GB")} reverted excluded`}
        />
        <LedgerMetric
          label="Needs category"
          value={(spending?.uncategorizedCount ?? 0).toLocaleString("en-GB")}
          detail="completed spending rows"
        />
        <LedgerMetric
          label="Unresolved transfer rows"
          value={(
            transferReview.unresolvedPositiveCount +
            transferReview.unresolvedNegativeCount
          ).toLocaleString("en-GB")}
          detail={`${transferReview.unresolvedPositiveCount} inflows · ${transferReview.unresolvedNegativeCount} outflows`}
        />
        <LedgerMetric
          label="Matched transfer pairs"
          value={transferReview.linkedPairs.toLocaleString("en-GB")}
          detail="two transaction rows per pair"
        />
      </section>
      {transferReview.unresolvedPositiveCount +
        transferReview.unresolvedNegativeCount >
        0 || reviewOnly ? (
        <Button
          className="w-fit"
          type="button"
          variant="outline"
          disabled={loading}
          onClick={toggleReview}
        >
          {reviewOnly ? "Show all activity" : "Show transfer review rows"}
        </Button>
      ) : null}
      {reviewOnly ? (
        <Card>
          <CardHeader className="gap-4 border-b">
            <div>
              <CardTitle>Grouped transfer review</CardTitle>
              <CardDescription>
                Open a group to inspect its exact rows. Click a checkbox, then
                Shift-click another to select the range between them.
              </CardDescription>
            </div>
            <MoneyTableSearch
              value={transferQuery}
              onValue={setTransferQuery}
              placeholder="Filter transfer groups…"
            />
          </CardHeader>
          <CardContent className="p-0">
            {transferReviewGroups.length ? (
              <div className="grid min-h-[32rem] lg:grid-cols-[minmax(18rem,.72fr)_minmax(32rem,1.28fr)]">
                <section className="border-b lg:border-r lg:border-b-0" aria-label="Unresolved transfer groups">
                  <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5 text-xs text-muted-foreground">
                    <span>{visibleTransferGroups.length.toLocaleString("en-GB")} groups</span>
                    <div className="flex items-center gap-1">
                      <Button type="button" size="sm" variant="ghost" onClick={() => changeTransferSort("count")}>Rows</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => changeTransferSort("total")}>Total</Button>
                    </div>
                  </div>
                  <div className="max-h-[42rem] divide-y overflow-y-auto">
                  {visibleTransferGroups.map((group) => (
                    <button
                      type="button"
                      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left ${MONEY_ROW_ACTION_CLASS} ${selectedTransferGroupId === group.representativeId ? "bg-accent" : ""}`}
                      key={group.representativeId}
                      aria-pressed={selectedTransferGroupId === group.representativeId}
                      onClick={() => openTransferGroup(group.representativeId)}
                    >
                      <span className="min-w-0">
                        <p
                          className="truncate font-medium"
                          title={group.description}
                        >
                          {group.description || group.sourceType}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {group.accountName} · {group.sourceType}
                        </p>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-right">
                          <Badge variant="outline">{group.count}</Badge>
                          <span className="mt-1 block font-mono text-xs">{signedMoney(group.totalMinor, group.currency)}</span>
                        </span>
                        <MoneyRowActionCue />
                      </span>
                    </button>
                  ))}
                  {visibleTransferGroups.length === 0 ? (
                    <p className="px-4 py-10 text-center text-muted-foreground">No transfer groups match this filter.</p>
                  ) : null}
                  </div>
                </section>
                <section className="min-w-0" aria-label="Selected transfer group details">
                  {selectedTransferGroup ? (
                    <>
                      <div className="border-b px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold">{selectedTransferGroup.description}</h3>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {selectedTransferGroup.count.toLocaleString("en-GB")} exact unresolved rows · {selectedTransferGroup.accountName} · {signedMoney(selectedTransferGroup.totalMinor, selectedTransferGroup.currency)}
                            </p>
                          </div>
                          <Badge variant="outline">{flowLabel(selectedTransferGroup.direction)}</Badge>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-2.5">
                        <div>
                          <strong>{selectedTransferRows.size.toLocaleString("en-GB")} selected</strong>
                          {selectedTransferRows.size ? <span className="ml-2 text-xs text-muted-foreground">{signedMoney(selectedTransferTotal, selectedTransferGroup.currency)}</span> : <span className="ml-2 text-xs text-muted-foreground">Click, then Shift-click for a range</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          {selectedTransferRows.size ? <Button type="button" size="sm" variant="ghost" onClick={() => toggleAllTransferRows(false)}>Clear</Button> : null}
                          <select
                            aria-label="Treatment for selected transfer rows"
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                            value={bulkDisposition}
                            disabled={selectedTransferRows.size === 0 || saving === "bulk-transfer-treatment"}
                            onChange={(event) => setBulkDisposition(event.currentTarget.value as MoneyTransferDisposition)}
                          >
                            <option value="">Choose treatment</option>
                            {MONEY_TRANSFER_DISPOSITIONS.map((disposition) => <option key={disposition} value={disposition}>{flowLabel(disposition)}</option>)}
                          </select>
                          <Button type="button" size="sm" disabled={!bulkDisposition || selectedTransferRows.size === 0 || saving === "bulk-transfer-treatment"} onClick={() => void applyBulkDisposition()}>
                            {saving === "bulk-transfer-treatment" ? "Applying…" : `Apply to ${selectedTransferRows.size.toLocaleString("en-GB")}`}
                          </Button>
                        </div>
                      </div>
                      <div className="max-h-[36rem] overflow-auto">
                        <table className="w-full min-w-[40rem] text-sm">
                          <caption className="sr-only">Transactions in {selectedTransferGroup.description}</caption>
                          <thead className="sticky top-0 border-b bg-background text-xs text-muted-foreground">
                            <tr>
                              <th className="w-10 px-4 py-3">
                                <input
                                  type="checkbox"
                                  aria-label={`Select all ${selectedTransferGroup.count} rows`}
                                  checked={selectedTransferRows.size === selectedTransferGroup.items.length && selectedTransferGroup.items.length > 0}
                                  onChange={(event) => toggleAllTransferRows(event.currentTarget.checked)}
                                />
                              </th>
                              <th className="px-4 py-3 text-left">Date</th>
                              <th className="px-4 py-3 text-left">Description</th>
                              <th className="px-4 py-3 text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {selectedTransferGroup.items.map((item, index) => {
                              const selected = selectedTransferRows.has(item.id);
                              return <tr key={item.id} className={selected ? "bg-accent/60" : "hover:bg-muted/30"}>
                                <td className="px-4 py-3">
                                  <input
                                    type="checkbox"
                                    aria-label={`Select ${item.description} from ${formatDate(item.occurredAt)}`}
                                    checked={selected}
                                    readOnly
                                    onClick={(event) => toggleTransferRow(item.id, index, event.currentTarget.checked, event.shiftKey)}
                                  />
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(item.occurredAt)}</td>
                                <td className="max-w-80 px-4 py-3"><p className="truncate font-medium" title={item.description}>{item.description}</p><p className="text-xs text-muted-foreground">{item.sourceType}</p></td>
                                <td className={`px-4 py-3 text-right font-mono font-medium ${item.amountMinor < 0 ? "text-rose-300" : "text-emerald-300"}`}>{signedMoney(item.amountMinor, item.currency)}</td>
                              </tr>;
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <EmptyLedger title="Select a transfer group" description="Choose a group to inspect every underlying transaction." />
                  )}
                </section>
              </div>
            ) : (
              <EmptyLedger
                title="Transfer review complete"
                description="No unresolved transfer groups remain."
              />
            )}
          </CardContent>
        </Card>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Change not saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {ruleCandidate ? (
        <Alert>
          <AlertTitle>Saved for this row</AlertTitle>
          <AlertDescription>
            <span>
              Apply this exact description to other transactions in{" "}
              {ruleCandidate.accountName}?
            </span>
            <Button
              className="ml-3"
              type="button"
              size="sm"
              variant="outline"
              disabled={saving === ruleCandidate.id}
              onClick={() =>
                void categorize(ruleCandidate, ruleCandidate.category, true)
              }
            >
              Create account rule
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {ruleAffected !== undefined ? (
        <Alert>
          <AlertTitle>Account rule applied</AlertTitle>
          <AlertDescription>
            {ruleAffected.toLocaleString("en-GB")} transaction
            {ruleAffected === 1 ? "" : "s"} now use this category.
          </AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader className="gap-4 border-b">
          <div>
            <CardTitle>Transaction activity</CardTitle>
            <CardDescription>
              Search, filters, and sorting query the complete ledger. Category
              rules remain account-scoped.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <MoneyTableSearch
              value={query}
              onValue={setQuery}
              placeholder="Search all transactions…"
              className="min-w-52 flex-1"
            />
            <select
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
              value={account}
              onChange={(event) => setAccount(event.currentTarget.value)}
              aria-label="Filter by account"
            >
              <option value="all">All accounts</option>
              {accounts.map((id) => (
                <option key={id} value={id}>
                  {accountLabels[id] ?? id}
                </option>
              ))}
            </select>
            <select
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
              value={flow}
              onChange={(event) =>
                setFlow(event.currentTarget.value as typeof flow)
              }
              aria-label="Filter by flow kind"
            >
              <option value="all">All flows</option>
              {[
                "spend",
                "refund",
                "transfer",
                "trade",
                "investment_income",
                "fee",
                "tax",
                "income",
                "balance_adjustment",
              ].map((value) => (
                <option key={value} value={value}>
                  {flowLabel(value)}
                </option>
              ))}
            </select>
            <select
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
              value={category}
              onChange={(event) =>
                setCategory(event.currentTarget.value as typeof category)
              }
              aria-label="Filter by category"
            >
              <option value="all">All categories</option>
              {MONEY_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <select
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm md:hidden"
              value={sort.key}
              onChange={(event) =>
                changeSort(event.currentTarget.value as MoneyActivitySortKey)
              }
              aria-label="Sort transactions by"
            >
              <option value="date">Date</option>
              <option value="description">Description</option>
              <option value="account">Account</option>
              <option value="flow">Flow</option>
              <option value="category">Category</option>
              <option value="costs">Costs</option>
              <option value="amount">Amount</option>
            </select>
            <select
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm md:hidden"
              value={sort.direction}
              onChange={(event) =>
                setSort((current) => ({
                  ...current,
                  direction: event.currentTarget.value as "asc" | "desc",
                }))
              }
              aria-label="Transaction sort direction"
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
            <Badge variant="outline" aria-live="polite">
              {loading
                ? "Searching"
                : `${resultTotal.toLocaleString("en-GB")} results`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent
          className="p-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
          tabIndex={0}
          role="region"
          aria-label="Transaction ledger"
        >
          {visible.length ? (
            <>
              {isMobile ? (
                <div
                  className="divide-y"
                  role="list"
                  aria-label="Transactions matching the current filters"
                >
                  {renderedRows.map((item) => (
                    <article
                      className="space-y-3 p-4"
                      key={item.id}
                      role="listitem"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3
                            className="truncate text-sm font-semibold"
                            title={item.description}
                          >
                            {item.description || item.sourceType}
                          </h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatDate(item.occurredAt)} · {item.accountName}
                          </p>
                        </div>
                        <strong
                          className={`shrink-0 font-mono text-sm ${item.amountMinor < 0 ? "text-rose-300" : "text-emerald-300"}`}
                        >
                          {signedMoney(item.amountMinor, item.currency)}
                        </strong>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          {flowLabel(item.flowKind)}
                        </Badge>
                        {item.feeMinor + item.taxMinor ? (
                          <span className="text-xs text-muted-foreground">
                            {money(
                              item.feeMinor + item.taxMinor,
                              item.currency,
                            )}{" "}
                            costs
                          </span>
                        ) : null}
                      </div>
                      <div className="grid gap-1 text-xs text-muted-foreground">
                        <span>Category · {item.categoryOrigin}</span>
                        <MoneyCategoryPicker
                          value={item.category}
                          disabled={saving === item.id}
                          mobile
                          ariaLabel={`Category for ${item.description}`}
                          onValue={(category) =>
                            void categorize(item, category)
                          }
                        />
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[64rem] text-sm">
                    <caption className="sr-only">
                      Transactions matching the current filters and sort
                    </caption>
                    <thead className="border-b text-xs text-muted-foreground">
                      <tr>
                        <MoneySortableHead
                          label="Date"
                          sortKey="date"
                          active={sort}
                          onSort={changeSort}
                        />
                        <MoneySortableHead
                          label="Description"
                          sortKey="description"
                          active={sort}
                          onSort={changeSort}
                        />
                        <MoneySortableHead
                          label="Account"
                          sortKey="account"
                          active={sort}
                          onSort={changeSort}
                        />
                        <MoneySortableHead
                          label="Flow"
                          sortKey="flow"
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
                          label="Costs"
                          sortKey="costs"
                          active={sort}
                          onSort={changeSort}
                          align="right"
                        />
                        <MoneySortableHead
                          label="Amount"
                          sortKey="amount"
                          active={sort}
                          onSort={changeSort}
                          align="right"
                        />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {renderedRows.map((item) => (
                        <tr key={item.id} className="hover:bg-muted/30">
                          <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                            {formatDate(item.occurredAt)}
                          </td>
                          <td className="max-w-80 px-4 py-3">
                            <p
                              className="truncate font-medium"
                              title={item.description}
                            >
                              {item.description || item.sourceType}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {item.sourceType}
                              {item.transferGroupId ? " · linked transfer" : ""}
                            </p>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            {item.accountName}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline">
                              {flowLabel(item.flowKind)}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <MoneyCategoryPicker
                              value={item.category}
                              disabled={saving === item.id}
                              ariaLabel={`Category for ${item.description}`}
                              onValue={(category) =>
                                void categorize(item, category)
                              }
                            />
                            <span className="ml-2 text-[.65rem] text-muted-foreground">
                              {item.categoryOrigin}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                            {item.feeMinor + item.taxMinor
                              ? money(
                                  item.feeMinor + item.taxMinor,
                                  item.currency,
                                )
                              : "—"}
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-mono font-medium ${item.amountMinor < 0 ? "text-rose-300" : "text-emerald-300"}`}
                          >
                            {signedMoney(item.amountMinor, item.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {isMobile && renderedRows.length < visible.length ? (
                <div className="border-t p-3 text-center">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loading}
                    onClick={() => setMobileLimit((current) => current + 50)}
                  >
                    Show 50 more
                  </Button>
                </div>
              ) : hasMore ? (
                <div className="border-t p-3 text-center">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loading}
                    onClick={() => void searchAll(true)}
                  >
                    {loading ? "Loading…" : "Load more results"}
                  </Button>
                </div>
              ) : null}
            </>
          ) : reviewOnly ? (
            <EmptyLedger
              title="Transfer review complete"
              description="No unreviewed transfers match the current filters."
            />
          ) : (
            <EmptyLedger
              title={
                transactionCount
                  ? "No matching activity"
                  : "No transactions imported"
              }
              description={
                transactionCount
                  ? "Change the search or flow filter."
                  : "Import a supported statement from Data quality."
              }
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

export function MoneyDataView({
  accounts,
  accountLastObserved,
  accountRoles,
  categoryRules,
  imports,
  marketData,
  months,
  revertedCount,
  spending,
  transactionCount,
  transferReview,
}: Pick<
  MoneyTrackerPageData,
  | "accounts"
  | "accountLastObserved"
  | "accountRoles"
  | "categoryRules"
  | "imports"
  | "marketData"
  | "months"
  | "revertedCount"
  | "spending"
  | "transactionCount"
  | "transferReview"
>) {
  const router = useRouter();
  const [deletingRule, setDeletingRule] = useState<string>();
  const [ruleError, setRuleError] = useState<string>();
  const unresolvedTransfers =
    transferReview.unresolvedPositiveCount +
    transferReview.unresolvedNegativeCount;
  const categorized = spending.categories.reduce(
    (sum, item) => sum + (item.category === "uncategorized" ? 0 : item.count),
    0,
  );
  const spendingRows = spending.categories.reduce(
    (sum, item) => sum + item.count,
    0,
  );
  const categoryCoverage = spendingRows
    ? (categorized / spendingRows) * 100
    : 0;
  const latestImport = imports.at(0);
  const latestBalanceDate = months.at(-1)?.date;
  const cashAccounts = accounts.filter(
    (account) => accountRoles[account] === "cash",
  );
  const freshAccounts = latestBalanceDate
    ? cashAccounts.filter(
        (account) => accountLastObserved[account] === latestBalanceDate,
      ).length
    : 0;
  const freshPositions = marketData.positions.filter(
    (position) => position.state === "fresh",
  ).length;
  const stalePositions = marketData.positions.filter(
    (position) => position.state === "stale",
  ).length;
  const unpricedPositions = marketData.positions.filter(
    (position) => position.state === "unpriced",
  ).length;
  const deleteRule = async (ruleId: string) => {
    setDeletingRule(ruleId);
    setRuleError(undefined);
    try {
      await moneyJson("/api/money/categories", { ruleId }, "DELETE");
      await router.invalidate();
    } catch (caught) {
      setRuleError(message(caught));
    } finally {
      setDeletingRule(undefined);
    }
  };
  return (
    <>
      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Data quality summary"
      >
        <LedgerMetric
          label="Ledger rows"
          value={transactionCount.toLocaleString("en-GB")}
          detail={`${imports.length.toLocaleString("en-GB")} committed imports`}
        />
        <LedgerMetric
          label="Spend rows categorized"
          value={
            spendingRows ? `${categoryCoverage.toFixed(1)}%` : "No spending"
          }
          detail={`${spending.uncategorizedCount.toLocaleString("en-GB")} rows need a category`}
        />
        <LedgerMetric
          label="Transfer review"
          value={unresolvedTransfers.toLocaleString("en-GB")}
          detail={`${transferReview.linkedPairs.toLocaleString("en-GB")} matched pairs`}
        />
        <LedgerMetric
          label="Fresh cash balances"
          value={`${freshAccounts} / ${cashAccounts.length}`}
          detail={
            latestBalanceDate
              ? `observed in ${latestBalanceDate}`
              : "No balance observations"
          }
        />
      </section>
      <section className="grid items-start gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Data health</CardTitle>
            <CardDescription>
              Ledger status and analytical limits
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y p-0">
            <QualityRow
              label="Completed ledger rows"
              value={(transactionCount - revertedCount).toLocaleString("en-GB")}
              state="Stored"
            />
            <QualityRow
              label="Reverted source rows"
              value={revertedCount.toLocaleString("en-GB")}
              state="Excluded"
            />
            <QualityRow
              label="Unresolved transfer rows"
              value={unresolvedTransfers.toLocaleString("en-GB")}
              state={unresolvedTransfers ? "Review" : "Clear"}
            />
            <QualityRow
              label="Open-position pricing"
              value={`${freshPositions} / ${marketData.positions.length} current`}
              state={
                unpricedPositions
                  ? "Needs prices"
                  : stalePositions
                    ? "Stale"
                    : "Current"
              }
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Active category rules</CardTitle>
            <CardDescription>
              Exact descriptions scoped to one account
            </CardDescription>
          </CardHeader>
          {ruleError ? (
            <p className="px-4 pt-3 text-xs text-rose-300" role="alert">
              {ruleError}
            </p>
          ) : null}
          <CardContent className="divide-y p-0">
            {categoryRules.length ? (
              categoryRules.map((rule) => (
                <div
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3"
                  key={rule.id}
                >
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">
                      {rule.description}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {rule.accountName} · {formatLabel(rule.category)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={deletingRule === rule.id}
                    onClick={() => void deleteRule(rule.id)}
                  >
                    {deletingRule === rule.id ? "Removing…" : "Remove"}
                  </Button>
                </div>
              ))
            ) : (
              <EmptyLedger
                title="No category rules"
                description="Create one after changing a transaction category."
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Repair queue</CardTitle>
            <CardDescription>
              Current issues with direct destinations
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y p-0">
            <RepairLink href="/money?view=transactions&category=uncategorized">
              <strong>
                {spending.uncategorizedCount.toLocaleString("en-GB")}
              </strong>{" "}
              uncategorized spending rows
            </RepairLink>
            <RepairLink href="/money?view=transactions&review=true">
              <strong>{unresolvedTransfers.toLocaleString("en-GB")}</strong>{" "}
              unresolved transfer rows
            </RepairLink>
            <RepairLink href="/money?view=investments">
              <strong>{unpricedPositions + stalePositions}</strong> positions
              need pricing attention
            </RepairLink>
            <RepairLink href="/money?view=accounts">
              <strong>{cashAccounts.length - freshAccounts}</strong> cash
              accounts not observed in {latestBalanceDate ?? "the latest month"}
            </RepairLink>
          </CardContent>
        </Card>
      </section>
      {latestImport ? (
        <Alert role="note">
          <AlertTitle>Latest import</AlertTitle>
          <AlertDescription>
            {latestImport.filename} added{" "}
            {latestImport.insertedCount.toLocaleString("en-GB")} rows on{" "}
            {formatDate(latestImport.committedAt)}. Raw file bytes were
            discarded after normalization.
          </AlertDescription>
        </Alert>
      ) : null}
      <MoneyImportsView imports={imports} />
    </>
  );
}

export function MoneyImportsView({
  imports,
}: Pick<MoneyTrackerPageData, "imports">) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<MoneyImportFile[]>([]);
  const [busy, setBusy] = useState<"preview" | "commit">();
  const [progress, setProgress] = useState(0);
  const [operationTotal, setOperationTotal] = useState(0);
  const [deleting, setDeleting] = useState<string>();
  const [deleteError, setDeleteError] = useState<string>();
  const [reimporting, setReimporting] = useState(false);
  const [reimportError, setReimportError] = useState<string>();
  const [reimportResult, setReimportResult] = useState<{
    importCount: number;
    transactionCount: number;
    linkedPairCount: number;
  }>();
  const [reimportOpen, setReimportOpen] = useState(false);
  const reimportingRef = useRef(false);
  const choose = (selected?: FileList | null) => {
    const next = Array.from(selected ?? []).map((file, index) => ({
      id: `${file.name}:${file.size}:${file.lastModified}:${index}`,
      file,
    }));
    setFiles(next);
    setBusy(undefined);
    setProgress(0);
    setOperationTotal(0);
  };
  const updateFile = (
    id: string,
    update: Partial<Pick<MoneyImportFile, "preview" | "receipt" | "error">>,
  ) =>
    setFiles((current) =>
      current.map((item) => (item.id === id ? { ...item, ...update } : item)),
    );
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
        updateFile(item.id, {
          preview: await moneyForm<MoneyImportPreview>(
            "/api/money/imports/preview",
            form,
          ),
          error: undefined,
        });
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
      const preview = item.preview;
      if (!preview) continue;
      updateFile(item.id, { error: undefined });
      try {
        const form = new FormData();
        form.set("file", item.file);
        form.set("expectedDigest", preview.digest);
        updateFile(item.id, {
          receipt: await moneyForm<MoneyImportReceipt>(
            "/api/money/imports",
            form,
          ),
          error: undefined,
        });
        imported = true;
      } catch (caught) {
        updateFile(item.id, { error: message(caught) });
      }
      setProgress(index + 1);
    }
    setBusy(undefined);
    if (imported) await router.invalidate();
  };
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
      const result = await moneyJson<{
        ok: true;
        importCount: number;
        transactionCount: number;
        linkedPairCount: number;
      }>("/api/money/imports/reimport", {});
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
    } else if (reimportResult) void router.invalidate();
  };
  const readyCount = files.filter(
    (item) => item.preview && !item.receipt,
  ).length;
  const completedCount = files.filter((item) => item.receipt).length;
  return (
    <section className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,.75fr)]">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Import statements</CardTitle>
          <CardDescription>
            Sparkasse XLSX, Revolut cash/trading TSV, portfolio CSV, or balance
            CSV
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          <input
            ref={input}
            className="sr-only"
            tabIndex={-1}
            type="file"
            multiple
            accept=".xlsx,.tsv,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/tab-separated-values,text/csv"
            disabled={busy !== undefined || reimporting}
            onChange={(event) => choose(event.currentTarget.files)}
          />
          <button
            type="button"
            disabled={busy !== undefined || reimporting}
            className="grid min-h-44 w-full place-items-center rounded-lg border border-dashed bg-muted/25 p-6 text-center transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => {
              if (input.current) {
                input.current.value = "";
                input.current.click();
              }
            }}
          >
            <span>
              <FileSpreadsheet className="mx-auto mb-3 size-8 text-cyan-300" />
              <strong className="block">
                {files.length
                  ? `${files.length.toLocaleString("en-GB")} file${files.length === 1 ? "" : "s"} selected`
                  : "Choose money exports"}
              </strong>
              <span className="mt-1 block text-sm text-muted-foreground">
                {files.length
                  ? formatBytes(
                      files.reduce((total, item) => total + item.file.size, 0),
                    )
                  : "Select one or more XLSX, TSV, or CSV files, up to 10 MB each"}
              </span>
            </span>
          </button>
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
              onRemove={(id) =>
                setFiles((current) => current.filter((item) => item.id !== id))
              }
            />
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Import history</CardTitle>
              <CardDescription>
                Rebuilds derived categories and transfer links from stored rows
              </CardDescription>
            </div>
            <AlertDialog open={reimportOpen} onOpenChange={changeReimportOpen}>
              <AlertDialogTrigger
                render={
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={
                      !imports.length ||
                      busy !== undefined ||
                      deleting !== undefined ||
                      reimporting
                    }
                  />
                }
              >
                <RefreshCw />
                Rebuild data
              </AlertDialogTrigger>
              <ReimportDialogContent
                reimporting={reimporting}
                result={reimportResult}
                error={reimportError}
                onRetry={() => void reimportAll()}
              />
            </AlertDialog>
          </div>
        </CardHeader>
        {deleteError ? (
          <Alert className="m-3 w-auto" variant="destructive">
            <AlertTitle>Import not deleted</AlertTitle>
            <AlertDescription>{deleteError}</AlertDescription>
          </Alert>
        ) : null}
        {reimportError ? (
          <Alert className="m-3 w-auto" variant="destructive">
            <AlertTitle>Rebuild failed</AlertTitle>
            <AlertDescription>{reimportError}</AlertDescription>
          </Alert>
        ) : null}
        {reimportResult ? (
          <Alert className="m-3 w-auto">
            <AlertTitle>Rebuild complete</AlertTitle>
            <AlertDescription>
              {reimportResult.transactionCount.toLocaleString("en-GB")}{" "}
              transactions rebuilt from{" "}
              {reimportResult.importCount.toLocaleString("en-GB")} documents ·{" "}
              {reimportResult.linkedPairCount.toLocaleString("en-GB")} transfer
              pairs linked
            </AlertDescription>
          </Alert>
        ) : null}
        <CardContent className="divide-y p-0">
          {imports.length ? (
            imports.map((item) => (
              <div className="space-y-1 px-4 py-3" key={item.id}>
                <div className="flex items-start justify-between gap-3">
                  <strong
                    className="min-w-0 truncate text-sm"
                    title={item.filename}
                  >
                    {item.filename}
                  </strong>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {item.insertedCount.toLocaleString("en-GB")} new
                    </Badge>
                    <AlertDialog>
                      <AlertDialogTrigger
                        aria-label={`Delete ${item.filename}`}
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            disabled={deleting !== undefined || reimporting}
                          />
                        }
                      >
                        <Trash2 className="text-rose-300" />
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Delete {item.filename}?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This cannot be undone. The raw file is already
                            discarded.{" "}
                            {item.insertedCount.toLocaleString("en-GB")}{" "}
                            transaction{item.insertedCount === 1 ? "" : "s"} and
                            all derived investment events, balance snapshots,
                            and analytics owned by this import will be removed.
                            Data from other imports will stay.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={deleting === item.id}>
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            disabled={deleting === item.id}
                            onClick={() => void deleteImport(item.id)}
                          >
                            {deleting === item.id
                              ? "Deleting…"
                              : "Delete import data"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDate(item.committedAt)} · {formatBytes(item.bytes)} ·{" "}
                  {item.duplicateCount.toLocaleString("en-GB")} duplicates
                </p>
                <p className="text-[.65rem] uppercase tracking-wide text-muted-foreground">
                  {formatLabel(item.format)}
                </p>
              </div>
            ))
          ) : (
            <EmptyLedger
              title="No imports yet"
              description="Completed imports will appear here with their row counts and digest-backed receipt."
            />
          )}
        </CardContent>
      </Card>
    </section>
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

export function MoneySpendingView({
  spending,
  transferReview,
}: Pick<MoneyTrackerPageData, "spending" | "transferReview">) {
  const [range, setRange] = useState<6 | 12 | "all">(12);
  const observed = spending.months.filter((month) => month.observed);
  const recent = range === "all" ? observed : observed.slice(-range);
  const totals = recent.reduce(
    (sum, month) => ({
      spend: sum.spend + month.spendMinor,
      refunds: sum.refunds + month.refundsMinor,
      income: sum.income + month.incomeMinor,
      fees: sum.fees + month.feesMinor,
      taxes: sum.taxes + month.taxesMinor,
      net: sum.net + month.netCashFlowMinor,
    }),
    { spend: 0, refunds: 0, income: 0, fees: 0, taxes: 0, net: 0 },
  );
  const maximum = Math.max(...recent.map((month) => month.spendMinor), 1);
  const monthCount = recent.length;
  const rangeLabel =
    range === "all"
      ? `All ${monthCount} activity months`
      : `Latest ${monthCount} activity months`;
  const average = (value: number) =>
    money(monthCount ? Math.round(value / monthCount) : 0, "EUR");
  const savingsRate = totals.income
    ? (totals.net / totals.income) * 100
    : undefined;
  const unresolvedTransfers =
    transferReview.unresolvedPositiveCount +
    transferReview.unresolvedNegativeCount;
  const uncategorized = spending.categories.find(
    (item) => item.category === "uncategorized",
  );
  return (
    <>
      <div className="flex justify-end">
        <div className="flex gap-1" role="group" aria-label="Cash-flow range">
          {([6, 12, "all"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              type="button"
              variant={range === value ? "default" : "outline"}
              onClick={() => setRange(value)}
            >
              {value === "all" ? "All" : `${value}M`}
            </Button>
          ))}
        </div>
      </div>
      {unresolvedTransfers ? (
        <Alert variant="destructive">
          <AlertTitle>Cash flow is incomplete</AlertTitle>
          <AlertDescription>
            {unresolvedTransfers.toLocaleString("en-GB")} transfer rows still
            need treatment. The totals below exclude them and should not be read
            as the change in your wealth.
          </AlertDescription>
        </Alert>
      ) : null}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <LedgerMetric
          label="Spending"
          value={money(totals.spend, "EUR")}
          detail={`${average(totals.spend)} / activity month`}
        />
        <LedgerMetric
          label="Income"
          value={money(totals.income, "EUR")}
          detail={`${average(totals.income)} / activity month`}
        />
        <LedgerMetric
          label={unresolvedTransfers ? "Classified net flow" : "Net cash flow"}
          value={signedMoney(totals.net, "EUR")}
          detail={
            unresolvedTransfers
              ? `${unresolvedTransfers.toLocaleString("en-GB")} transfers excluded`
              : savingsRate === undefined
                ? "No income in range"
                : `${savingsRate >= 0 ? "+" : ""}${savingsRate.toFixed(1)}% of income`
          }
          tone={totals.net}
        />
        <LedgerMetric
          label="Uncategorized spending"
          value={money(uncategorized?.amountMinor ?? 0, "EUR")}
          detail={`${spending.uncategorizedCount.toLocaleString("en-GB")} rows · all history`}
        />
      </section>
      <section className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,.65fr)]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Monthly spending</CardTitle>
            <CardDescription>
              Completed EUR spend, excluding transfers, trades, adjustments, and
              reverted rows
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-5">
            {recent.length ? (
              recent.map((month) => (
                <div
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs sm:grid-cols-[4.5rem_minmax(4rem,1fr)_7rem] sm:gap-3"
                  key={month.month}
                >
                  <span className="text-muted-foreground">{month.month}</span>
                  <div className="order-3 col-span-2 h-2 overflow-hidden rounded-full bg-muted sm:order-none sm:col-span-1">
                    <div
                      className="h-full rounded-full bg-cyan-300"
                      style={{
                        width: `${(month.spendMinor / maximum) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-right font-mono">
                    {money(month.spendMinor, "EUR")}
                  </span>
                </div>
              ))
            ) : (
              <EmptyLedger
                title="No spending history"
                description="Import a cash or card statement to build full-history analytics."
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>
              {unresolvedTransfers
                ? "Classified cash-flow reconciliation"
                : "Cash-flow reconciliation"}
            </CardTitle>
            <CardDescription>
              {rangeLabel} · unresolved transfers excluded
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y p-0">
            <DataRow label="Income" value={money(totals.income, "EUR")} />
            <DataRow label="Refunds" value={money(totals.refunds, "EUR")} />
            <DataRow
              label="Spending"
              value={`−${money(totals.spend, "EUR")}`}
            />
            <DataRow label="Fees" value={`−${money(totals.fees, "EUR")}`} />
            <DataRow label="Taxes" value={`−${money(totals.taxes, "EUR")}`} />
            <DataRow
              label={unresolvedTransfers ? "Classified net" : "Net cash flow"}
              value={signedMoney(totals.net, "EUR")}
            />
            <p className="px-4 py-3 text-xs text-muted-foreground">
              Income + refunds − spending − fees − taxes
            </p>
          </CardContent>
        </Card>
      </section>
    </>
  );
}

const marketChartConfig = {
  marketValue: { label: "Market value" },
  costBasis: { label: "Cost basis" },
} satisfies ChartConfig;

const MAX_PORTFOLIO_CHART_POINTS = 480;

export function MoneyInvestmentsView({
  investments,
  marketData,
}: Pick<MoneyTrackerPageData, "investments" | "marketData">) {
  const router = useRouter();
  const [period, setPeriod] = useState<"1y" | "all">("1y");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();
  const [positionQuery, setPositionQuery] = useState("");
  const [positionClass, setPositionClass] = useState<
    "all" | "equity" | "etf" | "crypto"
  >("all");
  const [positionSort, setPositionSort] = useState<MoneySort<PositionSortKey>>({
    key: "value",
    direction: "desc",
  });
  const cutoff = new Date(marketData.asOf);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const history = useMemo(
    () =>
      marketData.history
        .filter(
          (point) =>
            point.complete && (period === "all" || point.date >= cutoffDate),
        )
        .map((point) => ({
          date: point.date,
          marketValue: point.knownMarketValueMinor / 100,
          costBasis: point.costBasisMinor / 100,
        })),
    [cutoffDate, marketData.history, period],
  );
  const pricedPositions = marketData.positions.filter(
    (position) => position.marketValueMinor !== undefined,
  );
  const knownCostBasisMinor = pricedPositions.reduce(
    (sum, position) => sum + position.costBasisMinor,
    0,
  );
  const staleCount = marketData.positions.filter(
    (position) => position.state === "stale",
  ).length;
  const unpricedCount = marketData.positions.filter(
    (position) => position.state === "unpriced",
  ).length;
  const latestPriceDate = pricedPositions
    .flatMap((position) => (position.priceDate ? [position.priceDate] : []))
    .sort()
    .at(-1);
  const allocation = (["equity", "etf", "crypto"] as const).map(
    (assetClass) => ({
      assetClass,
      value: pricedPositions
        .filter((position) => position.assetClass === assetClass)
        .reduce((sum, position) => sum + (position.marketValueMinor ?? 0), 0),
    }),
  );
  const allocationTotal = allocation.reduce((sum, item) => sum + item.value, 0);
  const rankedPositions = [...pricedPositions].sort(
    (left, right) =>
      (right.marketValueMinor ?? 0) - (left.marketValueMinor ?? 0),
  );
  const largestPosition = rankedPositions[0];
  const largestShare =
    largestPosition?.marketValueMinor !== undefined && allocationTotal
      ? (largestPosition.marketValueMinor / allocationTotal) * 100
      : undefined;
  const topThreeValue = rankedPositions
    .slice(0, 3)
    .reduce((sum, position) => sum + (position.marketValueMinor ?? 0), 0);
  const topThreeShare = allocationTotal
    ? (topThreeValue / allocationTotal) * 100
    : undefined;
  const chartHistory = useMemo(
    () =>
      portfolioChartPoints(
        history,
        investments.trades.filter(
          (item) => period === "all" || item.date >= cutoffDate,
        ),
      ),
    [cutoffDate, history, investments.trades, period],
  );
  const equityPercent = allocationTotal
    ? (allocation[0]!.value / allocationTotal) * 100
    : 0;
  const etfPercent = allocationTotal
    ? (allocation[1]!.value / allocationTotal) * 100
    : 0;
  const donut = allocationTotal
    ? `conic-gradient(#67e8f9 0 ${equityPercent}%, #c084fc ${equityPercent}% ${equityPercent + etfPercent}%, #4ade80 ${equityPercent + etfPercent}% 100%)`
    : "#27272a";
  const visiblePositions = useMemo(() => {
    const normalized = positionQuery.trim().toLocaleLowerCase("en-GB");
    return marketData.positions
      .filter(
        (position) =>
          (positionClass === "all" || position.assetClass === positionClass) &&
          (!normalized ||
            `${position.name} ${position.providerKey ?? position.canonicalKey}`
              .toLocaleLowerCase("en-GB")
              .includes(normalized)),
      )
      .sort((left, right) => {
        const value = (position: typeof left) =>
          positionSort.key === "name"
            ? position.name
            : positionSort.key === "class"
              ? position.assetClass
              : positionSort.key === "quantity"
                ? Number(position.quantity)
                : positionSort.key === "close"
                  ? position.close
                    ? Number(position.close)
                    : undefined
                  : positionSort.key === "value"
                    ? position.marketValueMinor
                    : positionSort.key === "gain"
                      ? position.unrealizedGainMinor
                      : positionSort.key === "return"
                        ? position.unrealizedGainMinor === undefined ||
                          !position.costBasisMinor
                          ? undefined
                          : position.unrealizedGainMinor /
                            position.costBasisMinor
                        : position.state;
        return (
          compareMoneyValues(
            value(left),
            value(right),
            positionSort.direction,
          ) || left.name.localeCompare(right.name)
        );
      });
  }, [marketData.positions, positionClass, positionQuery, positionSort]);
  const changePositionSort = (key: PositionSortKey) =>
    setPositionSort((current) =>
      nextMoneySort(current, key, ["name", "class", "state"]),
    );
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
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Portfolio valuation</h2>
          <p className="text-sm text-muted-foreground">
            {marketData.positions.length.toLocaleString("en-GB")} open positions
            · cached closing prices in EUR
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unpricedCount || staleCount ? (
            <Badge variant="destructive">
              {unpricedCount
                ? `${unpricedCount} unpriced`
                : `${staleCount} stale`}
            </Badge>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw className={refreshing ? "opacity-50" : ""} />
            {refreshing ? "Refreshing…" : "Refresh prices"}
          </Button>
        </div>
      </div>
      {refreshError ? (
        <Alert variant="destructive">
          <AlertTitle>Prices not refreshed</AlertTitle>
          <AlertDescription>
            {refreshError}. Cached prices remain available.
          </AlertDescription>
        </Alert>
      ) : null}
      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Portfolio summary"
      >
        <MarketMetric
          label="Market value"
          value={money(marketData.totals.knownMarketValueMinor, "EUR")}
          detail={
            marketData.totals.complete
              ? "All open positions priced"
              : "Known positions only"
          }
        />
        <MarketMetric
          label="FIFO cost basis"
          value={money(marketData.totals.costBasisMinor, "EUR")}
          detail="Imported acquisitions and fees"
        />
        <MarketMetric
          label="Unrealized gain/loss"
          value={signedMoney(marketData.totals.knownUnrealizedGainMinor, "EUR")}
          detail={`${gainPercent(marketData.totals.knownUnrealizedGainMinor, knownCostBasisMinor)} on priced FIFO basis`}
          tone={marketData.totals.knownUnrealizedGainMinor}
        />
        <MarketMetric
          label="Largest position"
          value={
            largestPosition?.marketValueMinor === undefined
              ? "—"
              : money(largestPosition.marketValueMinor, "EUR")
          }
          detail={
            largestPosition && largestShare !== undefined
              ? `${largestPosition.name} · ${largestShare.toFixed(1)}%`
              : "No priced positions"
          }
        />
      </section>
      <section className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(17rem,.7fr)]">
        <Card>
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Portfolio value</CardTitle>
                <CardDescription>
                  Daily closes, FIFO basis, purchases, and sales
                </CardDescription>
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={period === "1y" ? "secondary" : "ghost"}
                  onClick={() => setPeriod("1y")}
                >
                  1Y
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={period === "all" ? "secondary" : "ghost"}
                  onClick={() => setPeriod("all")}
                >
                  All
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-5">
            {history.length ? (
              <>
                <ChartContainer
                  config={marketChartConfig}
                  className="h-[19rem] w-full aspect-auto"
                  initialDimension={{ width: 760, height: 304 }}
                  role="img"
                  aria-label="Historical market value and FIFO cost basis in euro, with purchase and sale markers"
                >
                  <AreaChartForPortfolio data={chartHistory} />
                </ChartContainer>
                <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span>
                    <i className="mr-1.5 inline-block size-2 rounded-full bg-emerald-400" />
                    Purchase
                  </span>
                  <span>
                    <i className="mr-1.5 inline-block size-2 rounded-full bg-rose-400" />
                    Sale
                  </span>
                  <span>Hover a marker for execution details</span>
                </div>
                <PortfolioHistoryDisclosure history={history} />
              </>
            ) : (
              <EmptyLedger
                title="No valuation history yet"
                description="Run the first price refresh to populate historical closing prices."
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Allocation and concentration</CardTitle>
            <CardDescription>
              Where the current portfolio value is concentrated
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5">
            <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-4">
              <div
                className="relative aspect-square rounded-full"
                style={{ background: donut }}
                aria-hidden="true"
              >
                <div className="absolute inset-[1.35rem] rounded-full bg-card" />
              </div>
              <div className="space-y-2">
                {allocation.map((item) => (
                  <AllocationRow
                    key={item.assetClass}
                    label={
                      item.assetClass === "equity"
                        ? "Stocks"
                        : item.assetClass === "etf"
                          ? "ETFs"
                          : "Crypto"
                    }
                    amountMinor={item.value}
                    value={
                      allocationTotal ? (item.value / allocationTotal) * 100 : 0
                    }
                  />
                ))}
              </div>
            </div>
            <div className="mt-5 divide-y border-t">
              <DataRow
                label="Largest position"
                value={
                  largestPosition && largestShare !== undefined
                    ? `${largestPosition.name} · ${largestShare.toFixed(1)}%`
                    : "—"
                }
              />
              <DataRow
                label="Top 3 share"
                value={
                  topThreeShare === undefined
                    ? "—"
                    : `${topThreeShare.toFixed(1)}%`
                }
              />
              <DataRow label="Valuation date" value={latestPriceDate ?? "—"} />
            </div>
            {unpricedCount || staleCount ? (
              <p className="mt-4 text-xs text-rose-300">
                Pricing needs attention:{" "}
                {unpricedCount ? `${unpricedCount} unpriced` : ""}
                {unpricedCount && staleCount ? " · " : ""}
                {staleCount ? `${staleCount} stale` : ""}.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>
      <Card>
        <CardHeader className="gap-4 border-b">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Positions</CardTitle>
              <CardDescription>
                Filter and sort current value, FIFO basis, and unrealized
                movement
              </CardDescription>
            </div>
            <Badge variant="outline">
              {visiblePositions.length} / {marketData.positions.length}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <MoneyTableSearch
              value={positionQuery}
              onValue={setPositionQuery}
              placeholder="Filter positions…"
              className="flex-1"
            />
            <select
              className="h-9 rounded-md border border-input bg-background px-2.5 text-sm"
              value={positionClass}
              onChange={(event) =>
                setPositionClass(
                  event.currentTarget.value as typeof positionClass,
                )
              }
              aria-label="Filter positions by asset class"
            >
              <option value="all">All classes</option>
              <option value="equity">Stocks</option>
              <option value="etf">ETFs</option>
              <option value="crypto">Crypto</option>
            </select>
          </div>
        </CardHeader>
        <CardContent
          className="overflow-x-auto p-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
          tabIndex={0}
          role="region"
          aria-label="Current portfolio positions"
        >
          <table className="w-full min-w-[60rem] text-sm">
            <caption className="sr-only">
              Current portfolio positions matching the active filter and sort
            </caption>
            <thead className="border-b text-xs text-muted-foreground">
              <tr>
                <MoneySortableHead
                  label="Instrument"
                  sortKey="name"
                  active={positionSort}
                  onSort={changePositionSort}
                />
                <MoneySortableHead
                  label="Class"
                  sortKey="class"
                  active={positionSort}
                  onSort={changePositionSort}
                />
                <MoneySortableHead
                  label="Quantity"
                  sortKey="quantity"
                  active={positionSort}
                  onSort={changePositionSort}
                  align="right"
                />
                <MoneySortableHead
                  label="Close"
                  sortKey="close"
                  active={positionSort}
                  onSort={changePositionSort}
                  align="right"
                />
                <MoneySortableHead
                  label="Value"
                  sortKey="value"
                  active={positionSort}
                  onSort={changePositionSort}
                  align="right"
                />
                <MoneySortableHead
                  label="Gain/loss"
                  sortKey="gain"
                  active={positionSort}
                  onSort={changePositionSort}
                  align="right"
                />
                <MoneySortableHead
                  label="Return"
                  sortKey="return"
                  active={positionSort}
                  onSort={changePositionSort}
                  align="right"
                />
                <MoneySortableHead
                  label="State"
                  sortKey="state"
                  active={positionSort}
                  onSort={changePositionSort}
                  align="right"
                />
              </tr>
            </thead>
            <tbody className="divide-y">
              {visiblePositions.map((position) => (
                <tr key={position.canonicalKey} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <strong>{position.name}</strong>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {position.providerKey ?? position.canonicalKey}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      FIFO {money(position.costBasisMinor, "EUR")} · avg{" "}
                      {averageBuy(position.costBasisMinor, position.quantity)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {position.assetClass}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {position.quantity}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {position.close && position.currency
                      ? decimalMoney(position.close, position.currency)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-medium">
                    {position.marketValueMinor === undefined
                      ? "—"
                      : money(position.marketValueMinor, "EUR")}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${toneClass(position.unrealizedGainMinor)}`}
                  >
                    {position.unrealizedGainMinor === undefined
                      ? "—"
                      : signedMoney(position.unrealizedGainMinor, "EUR")}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${toneClass(position.unrealizedGainMinor)}`}
                  >
                    {position.unrealizedGainMinor === undefined
                      ? "—"
                      : gainPercent(
                          position.unrealizedGainMinor,
                          position.costBasisMinor,
                        )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Badge
                      variant={
                        position.state === "unpriced"
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {position.state}
                      {position.priceDate ? ` · ${position.priceDate}` : ""}
                    </Badge>
                  </td>
                </tr>
              ))}
              {visiblePositions.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-10 text-center text-muted-foreground"
                    colSpan={8}
                  >
                    No positions match this filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <InvestmentActivityHistory investments={investments} />
    </>
  );
}

type PortfolioChartPoint = Readonly<{
  date: string;
  marketValue: number;
  costBasis: number;
  buyMarker?: number;
  sellMarker?: number;
  trades: MoneyTrackerPageData["investments"]["trades"];
}>;

type PortfolioHistoryPoint = Pick<
  PortfolioChartPoint,
  "date" | "marketValue" | "costBasis"
>;

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
          <stop offset="5%" stopColor="#67e8f9" stopOpacity={0.3} />
          <stop offset="95%" stopColor="#67e8f9" stopOpacity={0.02} />
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
        width={74}
        tickFormatter={(value: number) => compactEuro(value)}
      />
      <ChartTooltip content={PortfolioChartTooltip} />
      <Area
        dataKey="marketValue"
        name="Market value"
        type="monotone"
        fill="url(#money-market-value-fill)"
        stroke="#67e8f9"
        strokeWidth={2}
        isAnimationActive={false}
      />
      <Line
        dataKey="costBasis"
        name="Cost basis"
        type="stepAfter"
        stroke="#a1a1aa"
        strokeWidth={1.5}
        strokeDasharray="6 5"
        dot={false}
        isAnimationActive={false}
      />
      <Scatter
        dataKey="buyMarker"
        name="Purchase"
        fill="#34d399"
        stroke="#000"
        strokeWidth={2}
        r={5}
        isAnimationActive={false}
      />
      <Scatter
        dataKey="sellMarker"
        name="Sale"
        fill="#fb7185"
        stroke="#000"
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
}: TooltipContentProps<number, string>) {
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
                    ? "text-emerald-300"
                    : "text-rose-300"
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

function PortfolioHistoryDisclosure({
  history,
}: {
  history: readonly { date: string; marketValue: number; costBasis: number }[];
}) {
  return (
    <details className="mt-3 border-t pt-3">
      <summary className="w-fit cursor-pointer text-xs font-medium text-muted-foreground">
        View exact portfolio data
      </summary>
      <div className="mt-3 max-h-80 overflow-auto rounded-md border">
        <table className="w-full min-w-80 text-xs">
          <thead className="sticky top-0 border-b bg-card text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-right">Market value</th>
              <th className="px-3 py-2 text-right">FIFO basis</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {[...history].reverse().map((point) => (
              <tr key={point.date}>
                <td className="px-3 py-2">{point.date}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {preciseEuro(point.marketValue)}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {preciseEuro(point.costBasis)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
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
      <Alert role="note">
        <AlertTitle>Imported investment activity</AlertTitle>
        <AlertDescription>
          Realized gains use FIFO acquisition lots, actual EUR cash totals, and
          split-adjusted quantities. They include transaction fees and exclude
          taxes.
        </AlertDescription>
      </Alert>
      {realized.totals.unmatchedSaleCount ? (
        <Alert variant="destructive">
          <AlertTitle>Incomplete acquisition history</AlertTitle>
          <AlertDescription>
            {realized.totals.unmatchedSaleCount.toLocaleString("en-GB")} sale
            {realized.totals.unmatchedSaleCount === 1 ? "" : "s"} could not be
            fully matched to an earlier acquisition. Unmatched proceeds are
            excluded from realized gains.
          </AlertDescription>
        </Alert>
      ) : null}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <LedgerMetric
          label="Investment events"
          value={totals.eventCount.toLocaleString("en-GB")}
        />
        <LedgerMetric label="Bought" value={money(totals.boughtMinor, "EUR")} />
        <LedgerMetric label="Sold" value={money(totals.soldMinor, "EUR")} />
        <LedgerMetric
          label="Realized gain/loss"
          value={signedMoney(realized.totals.gainMinor, "EUR")}
          detail={`${gainPercent(realized.totals.gainMinor, realized.totals.costBasisMinor)} · ${realized.totals.saleCount.toLocaleString("en-GB")} matched sales`}
        />
        <LedgerMetric label="Income" value={money(totals.incomeMinor, "EUR")} />
        <LedgerMetric
          label="Fees + taxes"
          value={money(totals.feesMinor + totals.taxesMinor, "EUR")}
        />
      </section>
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Realized gains and losses</CardTitle>
          <CardDescription>
            Click a header to sort matched sales and FIFO results
          </CardDescription>
        </CardHeader>
        <CardContent
          className="overflow-x-auto p-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
          tabIndex={0}
          role="region"
          aria-label="Realized investment gains table"
        >
          {realized.positions.length ? (
            <table className="w-full min-w-[48rem] text-sm">
              <caption className="sr-only">
                Realized gains and losses by asset
              </caption>
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <MoneySortableHead
                    label="Asset"
                    sortKey="asset"
                    active={realizedSort}
                    onSort={changeRealizedSort}
                  />
                  <MoneySortableHead
                    label="Sales"
                    sortKey="sales"
                    active={realizedSort}
                    onSort={changeRealizedSort}
                    align="right"
                  />
                  <MoneySortableHead
                    label="Quantity sold"
                    sortKey="quantity"
                    active={realizedSort}
                    onSort={changeRealizedSort}
                    align="right"
                  />
                  <MoneySortableHead
                    label="Net proceeds"
                    sortKey="proceeds"
                    active={realizedSort}
                    onSort={changeRealizedSort}
                    align="right"
                  />
                  <MoneySortableHead
                    label="FIFO basis"
                    sortKey="basis"
                    active={realizedSort}
                    onSort={changeRealizedSort}
                    align="right"
                  />
                  <MoneySortableHead
                    label="Gain/loss"
                    sortKey="gain"
                    active={realizedSort}
                    onSort={changeRealizedSort}
                    align="right"
                  />
                  <MoneySortableHead
                    label="Return"
                    sortKey="return"
                    active={realizedSort}
                    onSort={changeRealizedSort}
                    align="right"
                  />
                </tr>
              </thead>
              <tbody className="divide-y">
                {sortedRealized.map((item) => (
                  <tr className="hover:bg-muted/30" key={item.symbol}>
                    <td className="px-4 py-3 font-medium">{item.symbol}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {item.saleCount}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {item.soldQuantity}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {money(item.proceedsMinor, "EUR")}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {money(item.costBasisMinor, "EUR")}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono font-medium ${item.gainMinor < 0 ? "text-rose-300" : "text-emerald-300"}`}
                    >
                      {signedMoney(item.gainMinor, "EUR")}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono ${item.gainMinor < 0 ? "text-rose-300" : "text-emerald-300"}`}
                    >
                      {gainPercent(item.gainMinor, item.costBasisMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyLedger
              title="No realized gains yet"
              description="Realized gains appear after a sale can be matched to earlier acquisition lots."
            />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Trade-derived quantities</CardTitle>
          <CardDescription>
            Click a header to sort cumulative activity by symbol
          </CardDescription>
        </CardHeader>
        <CardContent
          className="overflow-x-auto p-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
          tabIndex={0}
          role="region"
          aria-label="Trade-derived investment quantities table"
        >
          {positions.length ? (
            <table className="w-full min-w-[52rem] text-sm">
              <caption className="sr-only">
                Trade-derived quantities and cumulative cash flows by asset
              </caption>
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <MoneySortableHead
                    label="Asset"
                    sortKey="asset"
                    active={activitySort}
                    onSort={changeActivitySort}
                  />
                  <MoneySortableHead
                    label="Class"
                    sortKey="class"
                    active={activitySort}
                    onSort={changeActivitySort}
                  />
                  <MoneySortableHead
                    label="Quantity"
                    sortKey="quantity"
                    active={activitySort}
                    onSort={changeActivitySort}
                    align="right"
                  />
                  <MoneySortableHead
                    label="Bought"
                    sortKey="bought"
                    active={activitySort}
                    onSort={changeActivitySort}
                    align="right"
                  />
                  <MoneySortableHead
                    label="Sold"
                    sortKey="sold"
                    active={activitySort}
                    onSort={changeActivitySort}
                    align="right"
                  />
                  <MoneySortableHead
                    label="Income"
                    sortKey="income"
                    active={activitySort}
                    onSort={changeActivitySort}
                    align="right"
                  />
                  <MoneySortableHead
                    label="Costs"
                    sortKey="costs"
                    active={activitySort}
                    onSort={changeActivitySort}
                    align="right"
                  />
                </tr>
              </thead>
              <tbody className="divide-y">
                {sortedPositions.map((item, index) => (
                  <tr
                    className="hover:bg-muted/30"
                    key={`${item.symbol}:${item.name ?? index}`}
                  >
                    <td className="px-4 py-3">
                      <strong>{item.symbol}</strong>
                      {item.name ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {item.name}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item.assetClass ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {item.quantity}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {money(item.boughtMinor, item.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {money(item.soldMinor, item.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-300">
                      {money(item.incomeMinor, item.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-rose-300">
                      {money(item.feesMinor + item.taxesMinor, item.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyLedger
              title="No investment events"
              description="Import a supported trading TSV or portfolio CSV."
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

export function MoneyPlanningCard({
  planning,
}: Pick<MoneyTrackerPageData, "planning">) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Run-rate scenario</CardTitle>
        <CardDescription>
          Median of the latest 6 to 12 consecutive months with imported
          cash-flow activity. The current partial month is excluded.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5">
        {planning.ready ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Monthly median</p>
              <strong className="mt-1 block font-mono text-xl">
                {signedMoney(planning.medianMonthlyNetMinor, "EUR")}
              </strong>
              <p className="mt-1 text-xs text-muted-foreground">
                {planning.observedMonthCount} consecutive activity months
              </p>
            </div>
            {planning.projections.map((item) => (
              <div
                className="rounded-md border bg-muted/20 p-3"
                key={item.months}
              >
                <p className="text-xs text-muted-foreground">
                  Simple {item.months}-month run rate
                </p>
                <strong
                  className={`mt-1 block font-mono text-lg ${item.changeMinor < 0 ? "text-rose-300" : "text-emerald-300"}`}
                >
                  {signedMoney(item.changeMinor, "EUR")}
                </strong>
              </div>
            ))}
          </div>
        ) : planning.unresolvedTransferCount ? (
          <Alert>
            <AlertTitle>Scenario needs transfer review</AlertTitle>
            <AlertDescription>
              {planning.unresolvedTransferCount.toLocaleString("en-GB")}{" "}
              unlinked transfer-like inflows or outflows still need
              classification. Scenarios stay hidden until review is complete.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertTitle>Not enough history</AlertTitle>
            <AlertDescription>
              At least six consecutive past months with imported cash-flow
              activity are required. You currently have{" "}
              {planning.observedMonthCount}.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

export function MoneyBalanceEntry({
  accounts,
  accountLabels,
}: {
  accounts: string[];
  accountLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0] ?? "new");
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    setBusy(true);
    setError(undefined);
    setSaved(false);
    const form = new FormData(element);
    try {
      await moneyJson("/api/money/balances", {
        ...(accountId === "new"
          ? { accountName: String(form.get("accountName") ?? "") }
          : { accountId }),
        date: String(form.get("date") ?? ""),
        value: String(form.get("value") ?? ""),
        currency: "EUR",
      });
      setSaved(true);
      element.reset();
      await router.invalidate();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Add cash balance snapshot</CardTitle>
        <CardDescription>
          Update an existing cash account or explicitly create a new manual
          account
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5">
        <form
          className={`grid gap-3 ${accountId === "new" ? "lg:grid-cols-[minmax(11rem,1fr)_minmax(11rem,1fr)_10rem_10rem_auto]" : "sm:grid-cols-[minmax(12rem,1fr)_10rem_10rem_auto]"}`}
          onSubmit={(event) => void submit(event)}
        >
          <label className="space-y-1 text-xs text-muted-foreground">
            Account
            <select
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={accountId}
              onChange={(event) => setAccountId(event.currentTarget.value)}
            >
              {accounts.map((account) => (
                <option key={account} value={account}>
                  {accountLabels[account] ?? account}
                </option>
              ))}
              <option value="new">New manual account…</option>
            </select>
          </label>
          {accountId === "new" ? (
            <label className="space-y-1 text-xs text-muted-foreground">
              New account name
              <Input
                name="accountName"
                required
                maxLength={100}
                placeholder="Cash account"
              />
            </label>
          ) : null}
          <label className="space-y-1 text-xs text-muted-foreground">
            Date
            <Input name="date" type="date" required />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Value
            <Input
              name="value"
              inputMode="decimal"
              required
              placeholder="0.00"
            />
          </label>
          <Button className="self-end" disabled={busy}>
            {busy ? "Saving…" : "Save snapshot"}
          </Button>
        </form>
        {error ? (
          <p className="mt-3 text-sm text-rose-300" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="mt-3 text-sm text-emerald-300" role="status">
            Snapshot saved.
          </p>
        ) : null}
      </CardContent>
    </Card>
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
                      <p className="mt-1 text-[.68rem] text-muted-foreground">
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
                <p className="text-sm text-rose-300" role="alert">
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
function MarketMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: number;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[.68rem] font-semibold uppercase tracking-[.08em] text-muted-foreground">
          {label}
        </p>
        <strong
          className={`mt-1.5 block text-2xl tracking-tight ${toneClass(tone)}`}
        >
          {value}
        </strong>
        {detail ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            {detail}
          </span>
        ) : null}
      </CardContent>
    </Card>
  );
}
function RepairLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      className={`flex min-h-14 items-center justify-between gap-4 px-4 py-3 text-sm ${MONEY_ROW_ACTION_CLASS}`}
      href={href}
    >
      <span>{children}</span>
      <MoneyRowActionCue />
    </a>
  );
}
function AllocationRow({
  label,
  value,
  amountMinor,
}: {
  label: string;
  value: number;
  amountMinor: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <strong className="font-mono">
        {money(amountMinor, "EUR")} · {value.toFixed(1)}%
      </strong>
    </div>
  );
}
function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function LedgerMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: number;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[.68rem] font-semibold uppercase tracking-[.08em] text-muted-foreground">
          {label}
        </p>
        <strong
          className={`mt-1.5 block text-2xl tracking-tight ${toneClass(tone)}`}
        >
          {value}
        </strong>
        {detail ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            {detail}
          </span>
        ) : null}
      </CardContent>
    </Card>
  );
}
function QualityRow({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-sm">
      <div>
        <p className="font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{value}</p>
      </div>
      <Badge
        variant={
          state === "Review" || state === "Needs prices"
            ? "destructive"
            : "outline"
        }
      >
        {state}
      </Badge>
    </div>
  );
}
function EmptyLedger({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="grid min-h-36 place-items-center p-5 text-center">
      <div>
        <p className="font-medium">{title}</p>
        <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
function isTreatableTransfer(item: Activity) {
  return item.flowKind === "transfer" && item.status === "completed";
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
function averageBuy(costBasisMinor: number, quantity: string) {
  const units = Number(quantity);
  return units > 0
    ? new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR",
      }).format(costBasisMinor / 100 / units)
    : "—";
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
function signedMoney(minor: number, currency: string) {
  return `${minor >= 0 ? "+" : ""}${money(minor, currency)}`;
}
function toneClass(value?: number) {
  return value === undefined || value === 0
    ? ""
    : value < 0
      ? "text-rose-300"
      : "text-emerald-300";
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
function flowLabel(flow: string) {
  return flow.replaceAll("_", " ");
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
