"use client";

import { useEffect, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Check, RefreshCw } from "lucide-react";
import type { MoneyTrackerPageData } from "../src/protected-data.js";
import type { MoneyCategory, MoneyTransferDisposition } from "./money-enums.js";
import type { MoneyReviewCategoryItem, MoneyTransferReviewGroup } from "./money-repository.js";
import { Badge } from "../src/components/ui/badge.js";
import { Button } from "../src/components/ui/button.js";
import { BalanceForm } from "./money-balance-form.js";
import { MoneyCategoryPicker, moneyCategoryLabel } from "./money-category-picker.js";
import { MoneyImportDrop, MoneyImportHistory } from "./money-ledger-views.js";
import { MoneyRulesView } from "./money-rules-view.js";
import { MONEY_REVIEW_TABS, type MoneyReviewTab } from "./money-tracker-navigation.js";
import { EmptyState, formatDay, formatMinor, formatMonth, MoneyPanel } from "./money-ui.js";
import { countLabel } from "../src/lib/count-label.js";

const TAB_LABELS: Record<MoneyReviewTab, string> = { queue: "Queue", rules: "Rules", imports: "Imports" };
const TREATMENTS: readonly (readonly [MoneyTransferDisposition, string])[] = [
  ["internal_transfer", "Own transfer"],
  ["spend", "Spending"],
  ["income", "Income"],
  ["refund", "Refund"],
  ["excluded", "Leave out"],
];
const VISIBLE_GROUPS = 8;

/** One place for the work that keeps rows out of the totals, plus the rules and imports behind it. */
export function MoneyReviewView(props: MoneyTrackerPageData & { tab: MoneyReviewTab }) {
  const staleAccounts = staleCashAccounts(props);
  const stalePrices = props.marketData.positions.filter((position) => position.state !== "fresh");
  const counts: Record<MoneyReviewTab, number> = {
    queue: props.reviewCounts.uncategorized + props.transferReviewGroups.length + (stalePrices.length ? 1 : 0) + staleAccounts.length,
    rules: props.categoryRules.length + props.transferRules.length + props.transferPairRules.length,
    imports: props.imports.length,
  };
  return (
    <div className="money-stack">
      <nav className="flex gap-1 border-b" aria-label="Review sections">
        {MONEY_REVIEW_TABS.map((tab) => (
          <Link
            key={tab}
            to="/money"
            search={{ view: "review", tab: tab === "queue" ? undefined : tab }}
            aria-current={props.tab === tab ? "page" : undefined}
            className={`-mb-px inline-flex h-9 items-center gap-2 border-b-2 px-3 text-sm font-medium ${props.tab === tab ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {TAB_LABELS[tab]}
            <Badge variant="outline">{counts[tab].toLocaleString("en-GB")}</Badge>
          </Link>
        ))}
      </nav>
      {props.tab === "rules" ? (
        <MoneyRulesView {...props} />
      ) : props.tab === "imports" ? (
        <>
          <MoneyImportDrop lastImport={props.imports[0] ? formatDay(props.imports[0].committedAt) : undefined} />
          <MoneyImportHistory imports={props.imports} />
        </>
      ) : (
        <Queue {...props} staleAccounts={staleAccounts} stalePrices={stalePrices} />
      )}
    </div>
  );
}

function Queue(props: MoneyTrackerPageData & { staleAccounts: readonly string[]; stalePrices: MoneyTrackerPageData["marketData"]["positions"] }) {
  const empty = !props.reviewQueue.items.length && !props.transferReviewGroups.length && !props.stalePrices.length && !props.staleAccounts.length;
  return (
    <>
      <MoneyImportDrop lastImport={props.imports[0] ? formatDay(props.imports[0].committedAt) : undefined} />
      {empty ? (
        <MoneyPanel>
          <EmptyState title="Nothing to review">Every row has a category, every transfer has a treatment, and prices and balances are current.</EmptyState>
        </MoneyPanel>
      ) : null}
      {props.reviewCounts.sourceOtherRows ? (
        <p className="px-1 text-xs text-muted-foreground">
          {props.reviewCounts.sourceOtherRows.toLocaleString("en-GB")} spending and refund rows have the generic source category Other. <Link to="/money" search={{ view: "transactions", category: "other" }} className="money-inline-link">Review Other rows</Link>
        </p>
      ) : null}
      {props.reviewQueue.items.length ? <CategorizeQueue items={props.reviewQueue.items} common={props.reviewQueue.commonCategories} total={props.reviewCounts.uncategorized} spendingRows={props.reviewCounts.spendingRows} /> : null}
      {props.transferReviewGroups.length ? <TransferQueue groups={props.transferReviewGroups} /> : null}
      {props.stalePrices.length || props.staleAccounts.length ? (
        <div className="money-grid money-grid--two">
          {props.stalePrices.length ? <PriceQueue positions={props.stalePrices} /> : null}
          {props.staleAccounts.length ? <BalanceQueue accounts={props.staleAccounts} labels={props.accountLabels} lastObserved={props.accountLastObserved} months={props.months} /> : null}
        </div>
      ) : null}
    </>
  );
}

function QueueTitle({ title, count }: { title: string; count: number }) {
  return (
    <span className="flex items-center gap-2">
      {title}
      <Badge variant="outline" className={count ? "text-warning" : "text-positive"}>{count.toLocaleString("en-GB")}</Badge>
    </span>
  );
}

/** The first suggestion is highlighted. Keys 1 to 3 pick for the first row. */
function CategorizeQueue({ items, common, total, spendingRows }: { items: readonly MoneyReviewCategoryItem[]; common: readonly MoneyCategory[]; total: number; spendingRows?: number }) {
  const router = useRouter();
  const [done, setDone] = useState<readonly Readonly<{ id: string; description: string; category: MoneyCategory; affected: number }>[]>([]);
  const [scope, setScope] = useState<Record<string, "transaction" | "merchant">>({});
  const [saving, setSaving] = useState<string>();
  const [error, setError] = useState<string>();
  const open = items.filter((item) => !done.some((entry) => entry.id === item.id));
  const picks = (item: MoneyReviewCategoryItem) => [...new Set([...item.suggestions, ...common])].slice(0, 3);
  const canRule = (item: MoneyReviewCategoryItem) => item.flowKind === "spend" || item.flowKind === "refund";
  const apply = async (item: MoneyReviewCategoryItem, category: MoneyCategory) => {
    setSaving(item.id);
    setError(undefined);
    try {
      const createRule = canRule(item) && scope[item.id] === "merchant";
      const response = await fetch("/api/money/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: item.id, category, createRule }),
      });
      const body = (await response.json()) as { affectedCount?: number; message?: string };
      if (!response.ok) throw new Error(body.message ?? `The category was not saved (${response.status}).`);
      setDone((current) => [...current, { id: item.id, description: item.description, category, affected: body.affectedCount ?? 1 }]);
      await router.invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The category was not saved.");
    } finally {
      setSaving(undefined);
    }
  };
  const first = open[0];
  useEffect(() => {
    if (!first) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || !/^[1-3]$/.test(event.key) || target?.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      const category = picks(first)[Number(event.key) - 1];
      if (category && !saving) void apply(first, category);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <MoneyPanel title={<QueueTitle title="Categorize" count={Math.max(total - done.length, 0)} />} actions={<span className="hidden text-xs text-muted-foreground md:inline">Keys 1–3 pick a suggestion for the first row</span>}>
      {error ? <p className="px-4 pt-2 text-sm text-negative" role="alert">{error}</p> : null}
      {spendingRows ? <p className="px-4 pt-2 text-xs text-muted-foreground">{Math.max(total - done.length, 0)} of {spendingRows.toLocaleString("en-GB")} spending and refund rows need a category ({((Math.max(total - done.length, 0) / spendingRows) * 100).toFixed(1)}%).</p> : null}
      <ul className="mt-2 divide-y border-t">
        {open.map((item) => {
          const options = picks(item);
          const rule = canRule(item);
          return (
            <li key={item.id} className="grid gap-2 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 text-sm">
                  <strong className="font-semibold">{item.description || item.sourceType}</strong>{" "}
                  <span className="text-xs text-muted-foreground">{item.accountName} · {formatDay(item.occurredAt)}</span>
                </p>
                <strong className="shrink-0 font-semibold tabular-nums">{formatMinor(item.amountMinor, { precise: true })}</strong>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {options.map((category, index) => (
                  <Button key={category} type="button" size="sm" variant={index === 0 ? "secondary" : "outline"} disabled={saving !== undefined} onClick={() => void apply(item, category)}>
                    {moneyCategoryLabel(category)}
                    {item === first ? <kbd className="hidden font-mono text-xs opacity-60 md:inline">{index + 1}</kbd> : null}
                  </Button>
                ))}
                <MoneyCategoryPicker compact value="uncategorized" disabled={saving !== undefined} ariaLabel={`Choose another category for ${item.description}`} onValue={(category) => void apply(item, category)} />
              </div>
              {rule ? (
                <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <legend className="sr-only">Apply category to {item.description}</legend>
                  <label className="inline-flex items-center gap-1.5">
                    <input type="radio" name={`category-scope-${item.id}`} value="transaction" className="size-4 accent-[var(--primary)]" checked={scope[item.id] !== "merchant"} onChange={() => setScope((current) => ({ ...current, [item.id]: "transaction" }))} />
                    This transaction
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input type="radio" name={`category-scope-${item.id}`} value="merchant" className="size-4 accent-[var(--primary)]" checked={scope[item.id] === "merchant"} onChange={() => setScope((current) => ({ ...current, [item.id]: "merchant" }))} />
                    {item.similarCount
                      ? `This merchant description in ${item.accountName}: ${item.similarCount} other ${item.similarCount === 1 ? "row" : "rows"} and future imports`
                      : `This merchant description in ${item.accountName}, including future imports`}
                  </label>
                </fieldset>
              ) : null}
            </li>
          );
        })}
        {done.map((entry) => (
          <li key={entry.id} className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground" role="status">
            <Check className="size-4 text-positive" aria-hidden="true" />
            <span>
              {entry.description} → <strong className="font-medium text-foreground">{moneyCategoryLabel(entry.category)}</strong>
              {entry.affected > 1 ? ` · ${entry.affected} rows` : ""}
            </span>
          </li>
        ))}
      </ul>
      {total > items.length ? (
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
          Showing the newest {items.length} of {total.toLocaleString("en-GB")}.{" "}
          <Link to="/money" search={{ view: "transactions", review: true }} className="money-inline-link">Open all in Transactions</Link>
        </p>
      ) : null}
    </MoneyPanel>
  );
}

function TransferQueue({ groups }: { groups: readonly MoneyTransferReviewGroup[] }) {
  const router = useRouter();
  const [choice, setChoice] = useState<Record<string, MoneyTransferDisposition>>({});
  const [saving, setSaving] = useState<string>();
  const [error, setError] = useState<string>();
  const rows = groups.reduce((sum, group) => sum + group.count, 0);
  const apply = async (group: MoneyTransferReviewGroup) => {
    const disposition = choice[group.representativeId];
    if (!disposition) return;
    setSaving(group.representativeId);
    setError(undefined);
    try {
      const response = await fetch("/api/money/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionIds: group.items.map((item) => item.id), disposition }),
      });
      if (!response.ok) throw new Error(((await response.json()) as { message?: string }).message ?? `The treatment was not saved (${response.status}).`);
      await router.invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The treatment was not saved.");
    } finally {
      setSaving(undefined);
    }
  };
  return (
    <MoneyPanel
      title={<QueueTitle title="Transfers" count={groups.length} />}
      description={`${countLabel(rows, "row")} in ${countLabel(groups.length, "group")}. Own transfers do not count as income or spending.`}
      actions={<Link to="/money" search={{ view: "review", tab: "rules" }} className="money-inline-link">Make a rule</Link>}
    >
      {error ? <p className="px-4 pt-2 text-sm text-negative" role="alert">{error}</p> : null}
      <ul className="mt-2 divide-y border-t">
        {groups.slice(0, VISIBLE_GROUPS).map((group) => {
          const selected = choice[group.representativeId];
          return (
            <li key={group.representativeId} className="grid gap-2.5 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 text-sm">
                  <strong className="font-semibold">{group.description || group.sourceType}</strong>{" "}
                  <span className="text-xs text-muted-foreground">
                    {group.accountName} · {group.direction === "inflow" ? "incoming" : "outgoing"} · {group.count} {group.count === 1 ? "row" : "rows"}
                  </span>
                </p>
                <strong className="shrink-0 font-semibold tabular-nums">{formatMinor(group.totalMinor, { precise: true, signed: true })}</strong>
              </div>
              <p className="text-xs text-muted-foreground">
                {group.items.slice(0, 3).map((item) => `${formatDay(item.occurredAt)} ${formatMinor(item.amountMinor, { precise: true, signed: true })}`).join(" · ")}
                {group.items.length > 3 ? ` · ${group.items.length - 3} more` : ""}
              </p>
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Treatment for ${group.description}`}>
                {TREATMENTS.map(([disposition, label]) => (
                  <Button key={disposition} type="button" size="sm" variant={selected === disposition ? "secondary" : "outline"} aria-pressed={selected === disposition} onClick={() => setChoice((current) => ({ ...current, [group.representativeId]: disposition }))}>
                    {selected === disposition ? <Check /> : null}
                    {label}
                  </Button>
                ))}
                <span className="flex-1" />
                <Button type="button" size="sm" disabled={!selected || saving !== undefined} onClick={() => void apply(group)}>
                  {saving === group.representativeId ? "Saving…" : group.count === 1 ? "Apply" : `Apply to ${group.count} rows`}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {groups.length > VISIBLE_GROUPS ? (
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">{groups.length - VISIBLE_GROUPS} more groups appear as you finish these.</p>
      ) : null}
    </MoneyPanel>
  );
}

function PriceQueue({ positions }: { positions: MoneyTrackerPageData["marketData"]["positions"] }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const refresh = async () => {
    setRefreshing(true);
    setError(undefined);
    try {
      const response = await fetch("/api/money/market-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error(((await response.json()) as { message?: string }).message ?? `Prices were not refreshed (${response.status}).`);
      await router.invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Prices were not refreshed.");
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <MoneyPanel
      title={<QueueTitle title="Prices" count={positions.length} />}
      description="Portfolio value uses the last known price for these positions"
      actions={
        <Button type="button" size="sm" variant="outline" disabled={refreshing} onClick={() => void refresh()}>
          <RefreshCw />
          {refreshing ? "Refreshing…" : "Refresh prices"}
        </Button>
      }
    >
      {error ? <p className="px-4 pt-2 text-sm text-negative" role="alert">{error}</p> : null}
      <ul className="mt-2 divide-y border-t text-sm">
        {positions.map((position) => (
          <li key={position.canonicalKey} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="min-w-0 truncate font-medium">{position.name}</span>
            <span className="shrink-0 text-muted-foreground">{position.state === "unpriced" ? "No price" : position.priceDate ? `Price from ${formatDay(position.priceDate)}` : "Old price"}</span>
          </li>
        ))}
      </ul>
    </MoneyPanel>
  );
}

function BalanceQueue({
  accounts,
  labels,
  lastObserved,
  months,
}: {
  accounts: readonly string[];
  labels: Record<string, string>;
  lastObserved: Record<string, string>;
  months: MoneyTrackerPageData["months"];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string>();
  const latest = months.at(-1);
  return (
    <MoneyPanel title={<QueueTitle title="Balances" count={accounts.length} />} description="Cash accounts without a balance this month. Their last balance is carried.">
      <ul className="mt-2 divide-y border-t text-sm">
        {accounts.map((account) => (
          <li key={account}>
            <div className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                <span className="block truncate font-medium">{labels[account] ?? account}</span>
                <span className="text-xs text-muted-foreground">Last balance {lastObserved[account] ? formatMonth(lastObserved[account]!) : "never"}</span>
              </span>
              <Button type="button" size="sm" variant="outline" aria-expanded={editing === account} onClick={() => setEditing(editing === account ? undefined : account)}>
                Update
              </Button>
            </div>
            {editing === account ? (
              <BalanceForm
                accountId={account}
                label={labels[account] ?? account}
                value={latest?.values[account]}
                onCancel={() => setEditing(undefined)}
                onDone={async () => {
                  setEditing(undefined);
                  await router.invalidate();
                }}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </MoneyPanel>
  );
}

/** Cash accounts whose latest balance is older than the current month. */
function staleCashAccounts(props: Pick<MoneyTrackerPageData, "accounts" | "accountRoles" | "accountLastObserved">) {
  const currentMonth = `${new Date().toISOString().slice(0, 7)}-01`;
  return props.accounts.filter((account) => props.accountRoles[account] === "cash" && props.accountLastObserved[account] !== undefined && props.accountLastObserved[account]! < currentMonth);
}
