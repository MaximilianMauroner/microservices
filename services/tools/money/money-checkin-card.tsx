import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../src/components/ui/card.js";
import {
  NativeSelect,
  NativeSelectOption,
} from "../src/components/ui/native-select.js";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../src/components/ui/tabs.js";
import type { MoneyCheckIn, MoneyCheckInCashMove } from "./money-checkin-domain.js";

const VISIBLE_PER_SIDE = 4;
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

type MoverRow = Readonly<{ key: string; name: string; detail: string; valueMinor: number }>;
type BridgeTile = Readonly<{ label: string; value: string; toneMinor?: number; current?: boolean }>;

/** Overview card: what moved between the selected check-in and today. */
export function MoneyCheckInCard({
  checkIn,
  accountLabels,
}: {
  checkIn: MoneyCheckIn;
  accountLabels: Record<string, string>;
}) {
  const { bridge } = checkIn;
  const tiles: readonly BridgeTile[] = [
    { label: `Net worth ${formatDay(checkIn.baseline)}`, value: formatMoney(bridge.baselineNetWorthMinor) },
    { label: "Market", value: formatSignedMoney(bridge.marketMinor), toneMinor: bridge.marketMinor },
    { label: "Income", value: formatSignedMoney(bridge.incomeMinor), toneMinor: bridge.incomeMinor },
    { label: "Spending", value: formatSignedMoney(bridge.spendingMinor), toneMinor: bridge.spendingMinor },
    // Transfers between own accounts cancel out; anything left is shown instead of hidden.
    ...(Math.abs(bridge.otherMinor) >= 100
      ? [{ label: "Other", value: formatSignedMoney(bridge.otherMinor), toneMinor: bridge.otherMinor }]
      : []),
    { label: "Net worth now", value: formatMoney(bridge.currentNetWorthMinor), current: true },
  ];
  const positionRows = checkIn.positions.map((move): MoverRow => ({
    key: move.canonicalKey,
    name: move.name,
    detail: [
      move.returnPercent === undefined ? undefined : formatPercent(move.returnPercent),
      move.closed ? "sold" : undefined,
    ].filter(Boolean).join(" · "),
    valueMinor: move.moveMinor,
  }));
  const cashRows = checkIn.cash.map((move): MoverRow => ({
    key: move.accountId,
    name: accountLabels[move.accountId] ?? "Cash account",
    detail: cashDetail(move),
    valueMinor: move.changeMinor,
  }));
  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>What changed since check-in</CardTitle>
            <CardDescription>
              {formatDay(checkIn.baseline)} → today · a check-in is a day with a
              statement upload
            </CardDescription>
          </div>
          <MoneyCheckInPicker checkIn={checkIn} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <ol
          className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]"
          aria-label="Net worth bridge"
        >
          {tiles.map((tile) => (
            <li
              key={tile.label}
              className={`rounded-md border px-3 py-2 ${tile.current ? "col-span-2 border-lime-400/40 bg-lime-400/5 sm:col-span-1" : ""}`}
            >
              <span className="block text-[.68rem] font-semibold uppercase tracking-[.08em] text-muted-foreground">
                {tile.label}
              </span>
              <strong
                className={`mt-1 block font-mono text-base ${tile.toneMinor === undefined ? "" : changeClass(tile.toneMinor)}`}
              >
                {tile.value}
              </strong>
            </li>
          ))}
        </ol>
        <Tabs defaultValue="positions">
          <TabsList>
            <TabsTrigger value="positions">
              Positions<span className="hidden sm:inline"> · market move</span>
            </TabsTrigger>
            <TabsTrigger value="cash">
              Cash accounts<span className="hidden sm:inline"> · balance change</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="positions" className="pt-3">
            <Butterfly
              rows={positionRows}
              lossLabel="Losses"
              gainLabel="Gains"
              empty="No positions changed value since this check-in."
            />
            {checkIn.unpricedNames.length ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Not compared, prices missing: {checkIn.unpricedNames.join(", ")}
              </p>
            ) : null}
          </TabsContent>
          <TabsContent value="cash" className="pt-3">
            <Butterfly
              rows={cashRows}
              lossLabel="Decreased"
              gainLabel="Increased"
              empty="No cash balance changed since this check-in."
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Cash changes come from income, spending, and transfers. They are
              not market gains.
            </p>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

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

function Butterfly({
  rows,
  lossLabel,
  gainLabel,
  empty,
}: {
  rows: readonly MoverRow[];
  lossLabel: string;
  gainLabel: string;
  empty: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const losses = rows.filter((row) => row.valueMinor < 0).sort((left, right) => left.valueMinor - right.valueMinor);
  const gains = rows.filter((row) => row.valueMinor > 0).sort((left, right) => right.valueMinor - left.valueMinor);
  if (!losses.length && !gains.length) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  const scale = Math.max(...rows.map((row) => Math.abs(row.valueMinor)), 1);
  const hidden = (side: readonly MoverRow[]) => (expanded ? [] : side.slice(VISIBLE_PER_SIDE));
  const hiddenCount = hidden(losses).length + hidden(gains).length;
  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2 md:gap-0">
        {([["loss", losses, lossLabel], ["gain", gains, gainLabel]] as const).map(([side, items, label]) => {
          const visible = expanded ? items : items.slice(0, VISIBLE_PER_SIDE);
          return (
            <section
              key={side}
              aria-label={label}
              className={side === "loss" ? "md:border-r md:pr-4" : "md:pl-4"}
            >
              <h3
                className={`mb-1 text-[.68rem] font-semibold uppercase tracking-[.08em] ${side === "loss" ? "text-rose-400 md:text-right" : "text-emerald-400"}`}
              >
                {label} {formatSignedMoney(sum(items))}
              </h3>
              {visible.length ? (
                <ol>
                  {visible.map((row) => (
                    <MoverLine key={row.key} row={row} scale={scale} mirrored={side === "loss"} />
                  ))}
                </ol>
              ) : (
                <p className={`py-1 text-xs text-muted-foreground ${side === "loss" ? "md:text-right" : ""}`}>None</p>
              )}
              {hidden(items).length ? (
                <p className={`pt-1 text-xs text-muted-foreground ${side === "loss" ? "md:text-right" : ""}`}>
                  {hidden(items).length} more · {formatSignedMoney(sum(hidden(items)))}
                </p>
              ) : null}
            </section>
          );
        })}
      </div>
      {hiddenCount || expanded ? (
        <button
          type="button"
          className="mt-2 text-xs text-lime-400 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show the largest only" : `Show all ${rows.filter((row) => row.valueMinor !== 0).length}`}
        </button>
      ) : null}
    </div>
  );
}

function MoverLine({ row, scale, mirrored }: { row: MoverRow; scale: number; mirrored: boolean }) {
  // Losses mirror the gains on wide screens so both bars grow out from the middle.
  const align = mirrored ? "md:text-right" : "";
  return (
    <li
      className={`grid grid-cols-[minmax(0,1fr)_4.5rem_minmax(4rem,.8fr)] items-center gap-3 py-1 text-sm ${mirrored ? "" : "md:grid-cols-[minmax(4rem,.8fr)_4.5rem_minmax(0,1fr)]"}`}
    >
      <span
        className={`min-w-0 truncate ${align} ${mirrored ? "" : "md:order-3"}`}
        title={row.detail ? `${row.name} · ${row.detail}` : row.name}
      >
        <span className="font-medium">{row.name}</span>
        {row.detail ? (
          <span className="ml-1.5 font-mono text-xs text-muted-foreground">{row.detail}</span>
        ) : null}
      </span>
      <strong className={`font-mono text-sm ${changeClass(row.valueMinor)} ${align} ${mirrored ? "" : "md:order-2"}`}>
        {formatSignedMoney(row.valueMinor)}
      </strong>
      <span
        className={`flex h-2 overflow-hidden rounded-full bg-muted ${mirrored ? "md:justify-end" : "md:order-1"}`}
        aria-hidden="true"
      >
        <span
          className={`block h-full rounded-full ${row.valueMinor < 0 ? "bg-rose-400" : "bg-emerald-400"}`}
          style={{ width: `${(Math.abs(row.valueMinor) / scale) * 100}%` }}
        />
      </span>
    </li>
  );
}

function cashDetail(move: MoneyCheckInCashMove) {
  const parts: readonly (readonly [string, number])[] = [
    ["Income", move.incomeMinor],
    ["Spending", move.spendingMinor],
    ["Transfers", move.transfersMinor],
    ["Trades", move.tradesMinor],
    ["Other", move.otherMinor],
  ];
  return parts
    .filter(([, valueMinor]) => Math.abs(valueMinor) >= 50)
    .map(([label, valueMinor]) => `${label} ${formatSignedMoney(valueMinor)}`)
    .join(" · ");
}

function sum(rows: readonly MoverRow[]) {
  return rows.reduce((total, row) => total + row.valueMinor, 0);
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
  return value < 0 ? "text-rose-400" : value > 0 ? "text-emerald-400" : "text-muted-foreground";
}
