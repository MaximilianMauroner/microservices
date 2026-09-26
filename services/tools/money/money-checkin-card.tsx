import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import {
  NativeSelect,
  NativeSelectOption,
} from "../src/components/ui/native-select.js";
import { moneyCategoryLabel } from "./money-category-picker.js";
import type { MoneyCheckIn, MoneyCheckInOverview } from "./money-checkin-domain.js";
import { DivergingBar, formatDay as shortDay, MoneyPanel } from "./money-ui.js";

const currency = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const day = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

type BridgeRow = Readonly<{ key: string; label: string; valueMinor: number; drivers: readonly (readonly [label: string, valueMinor: number, note?: string])[]; note?: string }>;

/** Overview: what moved net worth between the selected check-in and today. Each row opens its drivers. */
export function MoneyCheckInBridge({
  checkIn,
  overview,
  accountLabels,
}: {
  checkIn: MoneyCheckIn;
  overview: MoneyCheckInOverview;
  accountLabels: Record<string, string>;
}) {
  const [open, setOpen] = useState<string | undefined>("market");
  const { bridge, spending } = overview;
  const byImpact = <Item,>(items: readonly Item[], value: (item: Item) => number) => [...items].sort((left, right) => Math.abs(value(right)) - Math.abs(value(left))).slice(0, VISIBLE_DRIVERS);
  const rows: readonly BridgeRow[] = [
    {
      key: "market",
      label: "Market",
      valueMinor: bridge.marketMinor,
      drivers: byImpact(checkIn.positions.filter((move) => move.moveMinor !== 0), (move) => move.moveMinor).map((move) => [move.name, move.moveMinor, move.returnPercent === undefined ? undefined : formatPercent(move.returnPercent)] as const),
      ...(checkIn.unpricedNames.length ? { note: `Not compared, prices missing: ${checkIn.unpricedNames.join(", ")}` } : {}),
    },
    {
      key: "income",
      label: "Income",
      valueMinor: bridge.incomeMinor,
      drivers: byImpact(overview.cash.filter((move) => move.incomeMinor > 0), (move) => move.incomeMinor).map((move) => [accountLabels[move.accountId] ?? "Cash account", move.incomeMinor] as const),
    },
    {
      key: "spending",
      label: "Spending",
      valueMinor: bridge.spendingMinor,
      drivers: byImpact(spending.categories, (category) => category.currentMinor).map((category) => [
        moneyCategoryLabel(category.category),
        -category.currentMinor,
        spending.previousBaseline ? `${formatMoney(category.previousMinor)} before` : category.merchants[0]?.label,
      ] as const),
    },
    // Transfers between own accounts cancel out; anything left is shown instead of hidden.
    ...(Math.abs(bridge.otherMinor) >= 100
      ? [{ key: "other", label: "Other", valueMinor: bridge.otherMinor, drivers: [], note: "Changes the classified flows do not explain, for example unreviewed transfers or balances that were not updated." }]
      : []),
  ];
  const scale = Math.max(...rows.map((row) => Math.abs(row.valueMinor)), 1);
  const change = bridge.currentNetWorthMinor - bridge.baselineNetWorthMinor;
  return (
    <MoneyPanel title="Since check-in" description={`${shortDay(checkIn.baseline)} → today`} actions={<MoneyCheckInPicker checkIn={checkIn} />} label="Net worth bridge">
      <div className="py-1.5 text-sm">
        <div className={BRIDGE_ROW}>
          <span className="text-muted-foreground">Net worth {shortDay(checkIn.baseline)}</span>
          <span />
          <span className="text-right font-semibold tabular-nums">{formatMoney(bridge.baselineNetWorthMinor)}</span>
        </div>
        {rows.map((row) => {
          const expanded = open === row.key;
          const driverScale = Math.max(...row.drivers.map(([, value]) => Math.abs(value)), 1);
          return (
            <div key={row.key}>
              <button type="button" className={`${BRIDGE_ROW} w-full text-left hover:bg-muted/60`} aria-expanded={expanded} onClick={() => setOpen(expanded ? undefined : row.key)}>
                <span className="flex items-center gap-1.5">
                  <ChevronRight className={`size-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden="true" />
                  {row.label}
                </span>
                <DivergingBar value={row.valueMinor} maximum={scale} />
                <span className={`text-right font-semibold tabular-nums ${changeClass(row.valueMinor)}`}>{formatSignedMoney(row.valueMinor)}</span>
              </button>
              {expanded ? (
                <div className="pb-2">
                  {row.drivers.map(([label, value, note]) => (
                    <div key={label} className={`${BRIDGE_ROW} py-1 text-[.8125rem]`}>
                      <span className="min-w-0 truncate pl-5 text-muted-foreground" title={note ? `${label} · ${note}` : label}>{label}</span>
                      <DivergingBar value={value} maximum={driverScale} />
                      <span className="text-right tabular-nums">
                        {note ? <span className="mr-2 text-xs text-muted-foreground">{note}</span> : null}
                        {formatSignedMoney(value)}
                      </span>
                    </div>
                  ))}
                  {row.drivers.length === 0 && !row.note ? <p className="px-4 pl-9 text-xs text-muted-foreground">Nothing recorded since the check-in.</p> : null}
                  {row.note ? <p className="px-4 pl-9 text-xs text-muted-foreground">{row.note}</p> : null}
                </div>
              ) : null}
            </div>
          );
        })}
        <div className={`${BRIDGE_ROW} mt-1 border-t pt-2.5`}>
          <strong className="font-semibold">Net worth now</strong>
          <span className={`text-right text-xs tabular-nums ${changeClass(change)}`}>{formatSignedMoney(change)}</span>
          <strong className="text-right text-base font-semibold tabular-nums">{formatMoney(bridge.currentNetWorthMinor)}</strong>
        </div>
      </div>
    </MoneyPanel>
  );
}

const VISIBLE_DRIVERS = 6;
const BRIDGE_ROW = "grid grid-cols-[minmax(6.5rem,9rem)_minmax(3rem,1fr)_minmax(5.5rem,auto)] items-center gap-3 px-4 py-1.5";

/** Lets the user compare with an older upload day. The choice lives in the URL. */
export function MoneyCheckInPicker({
  checkIn,
  view,
}: {
  checkIn: Pick<MoneyCheckIn, "days" | "baseline">;
  view?: "investments";
}) {
  const navigate = useNavigate();
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      Since
      <NativeSelect
        size="sm"
        value={checkIn.baseline}
        aria-label="Compare with check-in"
        onChange={(event) =>
          void navigate({
            to: "/money",
            search: { view, since: event.currentTarget.value },
          })
        }
      >
        {[...checkIn.days].reverse().map((option) => (
          <NativeSelectOption key={option} value={option}>
            {formatDay(option)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  );
}

export function formatDay(date: string) {
  return day.format(new Date(`${date}T00:00:00Z`));
}

function formatMoney(valueMinor: number) {
  return currency.format(valueMinor / 100);
}

export function formatSignedMoney(valueMinor: number) {
  return `${valueMinor > 0 ? "+" : ""}${currency.format(valueMinor / 100)}`;
}

export function formatPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function changeClass(value: number) {
  return value < 0 ? "text-negative" : value > 0 ? "text-positive" : "text-muted-foreground";
}

