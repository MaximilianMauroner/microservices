import { useState, type ReactElement, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../src/components/ui/card.js";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../src/components/ui/hover-card.js";
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
import { CategoryValue, moneyCategoryLabel } from "./money-category-picker.js";
import type {
  MoneyCheckIn,
  MoneyCheckInCashMove,
  MoneyCheckInOverview,
  MoneyCheckInPositionMove,
  MoneyCheckInSpendingCategory,
} from "./money-checkin-domain.js";

const VISIBLE_PER_COLUMN = 6;
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

type Tone = "up" | "down";
type DetailLine = readonly [label: string, value: string, tone?: Tone];
type MoverRow = Readonly<{
  key: string;
  name: ReactNode;
  title: string;
  sub?: string;
  valueMinor: number;
  tone: Tone;
  details: readonly DetailLine[];
  note: string;
}>;
type Column = Readonly<{ title: string; tone: Tone; rows: readonly MoverRow[] }>;

/** Overview card: what moved between the selected check-in and today. */
export function MoneyCheckInCard({
  checkIn,
  overview,
  accountLabels,
}: {
  checkIn: MoneyCheckIn;
  overview: MoneyCheckInOverview;
  accountLabels: Record<string, string>;
}) {
  const { bridge, spending } = overview;
  const since = formatDay(checkIn.baseline);
  const tiles: readonly (Readonly<{ label: string; valueMinor: number; signed?: boolean; current?: boolean; note: string }>)[] = [
    { label: `Net worth ${since}`, valueMinor: bridge.baselineNetWorthMinor, note: "Known net worth on the check-in day: cash balances plus priced positions." },
    { label: "Market", valueMinor: bridge.marketMinor, signed: true, note: "Price moves of your positions. Purchases and sales are excluded." },
    { label: "Income", valueMinor: bridge.incomeMinor, signed: true, note: "Salary, interest, refunds, and investment income on cash accounts." },
    { label: "Spending", valueMinor: bridge.spendingMinor, signed: true, note: "Card payments and bills on cash accounts, including fees and taxes." },
    // Transfers between own accounts cancel out; anything left is shown instead of hidden.
    ...(Math.abs(bridge.otherMinor) >= 100
      ? [{ label: "Other", valueMinor: bridge.otherMinor, signed: true, note: "Changes the classified flows do not explain, for example unreviewed transfers or balances that were not updated." }]
      : []),
    { label: "Net worth now", valueMinor: bridge.currentNetWorthMinor, current: true, note: "Latest cash balances plus current prices." },
  ];
  const cashRows = overview.cash.map((move) => cashRow(move, accountLabels[move.accountId] ?? "Cash account", since));
  const previous = spending.previousBaseline;
  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>What changed since check-in</CardTitle>
            <CardDescription>
              {since} → today · a check-in is a day with a statement upload
            </CardDescription>
          </div>
          <MoneyCheckInPicker checkIn={checkIn} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol
          className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]"
          aria-label="Net worth bridge"
        >
          {tiles.map((tile) => (
            <li key={tile.label} className={tile.current ? "col-span-2 sm:col-span-1" : ""}>
              <Detail
                trigger={
                  <button
                    type="button"
                    className={`w-full cursor-help rounded-md border px-3 py-2 text-left outline-none hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring ${tile.current ? "border-lime-400/40 bg-lime-400/5" : ""}`}
                  />
                }
                content={<p className="text-xs text-muted-foreground">{tile.note}</p>}
                title={tile.label}
              >
                <span className="block text-[.68rem] font-semibold uppercase tracking-[.08em] text-muted-foreground">
                  {tile.label}
                </span>
                <strong className={`mt-1 block font-mono text-base ${tile.signed ? changeClass(tile.valueMinor) : ""}`}>
                  {tile.signed ? formatSignedMoney(tile.valueMinor) : formatMoney(tile.valueMinor)}
                </strong>
              </Detail>
            </li>
          ))}
        </ol>
        <Tabs defaultValue="positions">
          <TabsList>
            <TabsTrigger value="positions">
              Positions <Count value={checkIn.positions.length} />
            </TabsTrigger>
            <TabsTrigger value="cash">
              Cash accounts <Count value={overview.cash.length} />
            </TabsTrigger>
            <TabsTrigger value="spending">
              Spending <Count value={spending.categories.length} />
            </TabsTrigger>
          </TabsList>
          <TabsContent value="positions" className="pt-3">
            <HeadToHead
              columns={[
                { title: "Gains", tone: "up", rows: checkIn.positions.filter((move) => move.moveMinor > 0).map((move) => positionRow(move, since)) },
                { title: "Losses", tone: "down", rows: checkIn.positions.filter((move) => move.moveMinor < 0).map((move) => positionRow(move, since)) },
              ]}
            />
            {checkIn.unpricedNames.length ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Not compared, prices missing: {checkIn.unpricedNames.join(", ")}
              </p>
            ) : null}
          </TabsContent>
          <TabsContent value="cash" className="pt-3">
            <HeadToHead
              columns={[
                { title: "Increased", tone: "up", rows: cashRows.filter((row) => row.valueMinor > 0) },
                { title: "Decreased", tone: "down", rows: cashRows.filter((row) => row.valueMinor < 0) },
              ]}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Each account shows its largest flow in the direction of its
              change. Cash changes are not market gains.
            </p>
          </TabsContent>
          <TabsContent value="spending" className="pt-3">
            {previous ? (
              <SpendingComparison
                categories={spending.categories}
                since={since}
                previous={formatDay(previous)}
              />
            ) : (
              <HeadToHead
                columns={[
                  {
                    title: `Spending since ${since}`,
                    tone: "down",
                    rows: spending.categories.map((category) => spendingRow(category, since)),
                  },
                ]}
              />
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Categorized spending: {formatMoney(spending.currentTotalMinor)}
              {previous ? ` vs ${formatMoney(spending.previousTotalMinor)} in the previous period.` : ". No earlier check-in to compare with."}
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

function SpendingComparison({
  categories,
  since,
  previous,
}: {
  categories: readonly MoneyCheckInSpendingCategory[];
  since: string;
  previous: string;
}) {
  const changed = (direction: 1 | -1) =>
    categories.filter((category) => Math.sign(category.currentMinor - category.previousMinor) === direction);
  const unchanged = categories.filter((category) => category.currentMinor === category.previousMinor);
  const row = (category: MoneyCheckInSpendingCategory): MoverRow => {
    const deltaMinor = category.currentMinor - category.previousMinor;
    const percent = category.previousMinor ? ` · ${formatPercent((deltaMinor / category.previousMinor) * 100)}` : "";
    return {
      ...spendingRow(category, since),
      sub: `${formatMoney(category.currentMinor)} vs ${formatMoney(category.previousMinor)}${percent}`,
      valueMinor: deltaMinor,
      // Spending more costs money, so it takes the loss colour.
      tone: deltaMinor > 0 ? "down" : "up",
      details: [
        [`${since} → today`, formatMoney(category.currentMinor)],
        [`${previous} → ${since}`, formatMoney(category.previousMinor)],
        ...category.merchants.map((merchant): DetailLine => [merchant.label, formatMoney(merchant.amountMinor)]),
      ],
      note: "Compared with the period between the previous two check-ins.",
    };
  };
  return (
    <>
      <HeadToHead
        columns={[
          { title: "Spent more", tone: "down", rows: changed(1).map(row) },
          { title: "Spent less", tone: "up", rows: changed(-1).map(row) },
        ]}
      />
      {unchanged.length ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Unchanged: {unchanged.map((category) => moneyCategoryLabel(category.category)).join(", ")}
        </p>
      ) : null}
    </>
  );
}

/** Two columns with the same alignment. A soft fill behind each row shows its size. */
function HeadToHead({ columns }: { columns: readonly Column[] }) {
  const scale = Math.max(...columns.flatMap((column) => column.rows.map((row) => Math.abs(row.valueMinor))), 1);
  return (
    <div className={`grid gap-6 ${columns.length > 1 ? "md:grid-cols-2" : ""}`}>
      {columns.map((column) => (
        <HeadToHeadColumn key={column.title} column={column} scale={scale} />
      ))}
    </div>
  );
}

function HeadToHeadColumn({ column, scale }: { column: Column; scale: number }) {
  const [expanded, setExpanded] = useState(false);
  const rows = [...column.rows].sort((left, right) => Math.abs(right.valueMinor) - Math.abs(left.valueMinor));
  const hidden = rows.slice(VISIBLE_PER_COLUMN);
  const visible = expanded ? rows : rows.slice(0, VISIBLE_PER_COLUMN);
  const total = rows.reduce((sum, row) => sum + row.valueMinor, 0);
  return (
    <section aria-label={column.title} className="min-w-0">
      <h3 className="mb-1 flex items-baseline gap-2 border-b px-2.5 pb-1.5 text-[.68rem] font-semibold uppercase tracking-[.08em]">
        <span className={column.tone === "up" ? "text-emerald-400" : "text-rose-400"}>{column.title}</span>
        <span className={`font-mono normal-case tracking-normal ${toneClass(column.tone)}`}>{formatSignedMoney(total)}</span>
        <span className="font-normal normal-case tracking-normal text-muted-foreground">· {rows.length}</span>
      </h3>
      {visible.length ? (
        <ol className="space-y-0.5">
          {visible.map((row) => (
            <MoverLine key={row.key} row={row} scale={scale} />
          ))}
        </ol>
      ) : (
        <p className="px-2.5 py-1 text-sm text-muted-foreground">None</p>
      )}
      {hidden.length ? (
        <button
          type="button"
          className="mt-1 px-2.5 text-xs text-lime-400 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show fewer" : `+${hidden.length} more · ${formatSignedMoney(hidden.reduce((sum, row) => sum + row.valueMinor, 0))}`}
        </button>
      ) : null}
    </section>
  );
}

function MoverLine({ row, scale }: { row: MoverRow; scale: number }) {
  return (
    <li>
      <Detail
        title={row.title}
        trigger={
          <button
            type="button"
            className="relative grid w-full grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-3 rounded-md px-2.5 py-1.5 text-left text-sm outline-none hover:ring-1 hover:ring-foreground/20 focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto_5.5rem]"
          />
        }
        content={
          <>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-xs">
              {row.details.map(([label, value, tone]) => (
                <DetailRow key={label} label={label} value={value} tone={tone} />
              ))}
            </dl>
            <p className="mt-2 text-[.7rem] text-muted-foreground">{row.note}</p>
          </>
        }
      >
        <span
          aria-hidden="true"
          className={`absolute inset-y-0 left-0 rounded-md ${row.tone === "up" ? "bg-emerald-400/12" : "bg-rose-400/12"}`}
          style={{ width: `${(Math.abs(row.valueMinor) / scale) * 100}%` }}
        />
        <span className={`relative min-w-0 truncate ${toneClass(row.tone)}`} title={row.title}>{row.name}</span>
        <span className="relative hidden max-w-56 truncate text-right font-mono text-xs text-muted-foreground sm:block">{row.sub}</span>
        <strong className={`relative text-right font-mono ${toneClass(row.tone)}`}>{formatSignedMoney(row.valueMinor)}</strong>
      </Detail>
    </li>
  );
}

/** Opens on hover and keyboard focus. Rendered in a portal so the card does not clip it. */
function Detail({
  trigger,
  title,
  content,
  children,
}: {
  trigger: ReactElement;
  title: string;
  content: ReactNode;
  children: ReactNode;
}) {
  return (
    <HoverCard>
      <HoverCardTrigger delay={150} closeDelay={100} render={trigger}>
        {children}
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="end" className="w-72 p-3">
        <p className="mb-2 truncate text-sm font-medium">{title}</p>
        {content}
      </HoverCardContent>
    </HoverCard>
  );
}

function DetailRow({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return (
    <>
      <dt className="min-w-0 truncate text-muted-foreground">{label}</dt>
      <dd className={`text-right font-mono ${tone ? toneClass(tone) : ""}`}>{value}</dd>
    </>
  );
}

function Count({ value }: { value: number }) {
  return <span className="rounded bg-muted px-1.5 font-mono text-[.7rem] text-muted-foreground">{value}</span>;
}

function positionRow(move: MoneyCheckInPositionMove, since: string): MoverRow {
  const tone: Tone = move.moveMinor > 0 ? "up" : "down";
  return {
    key: move.canonicalKey,
    name: move.name,
    title: move.name,
    sub: [move.returnPercent === undefined ? undefined : formatPercent(move.returnPercent), move.closed ? "sold" : undefined]
      .filter(Boolean)
      .join(" · "),
    valueMinor: move.moveMinor,
    tone,
    details: [
      [`Value ${since}`, formatMoney(move.baselineValueMinor)],
      ["Bought", move.boughtMinor ? formatMoney(move.boughtMinor) : "—"],
      ["Sold", move.soldMinor ? formatMoney(move.soldMinor) : "—"],
      ["Value now", formatMoney(move.currentValueMinor)],
      ["Market move", `${formatSignedMoney(move.moveMinor)}${move.returnPercent === undefined ? "" : ` · ${formatPercent(move.returnPercent)}`}`, tone],
    ],
    note: "Market move = value now − value at check-in − bought + sold.",
  };
}

function cashRow(move: MoneyCheckInCashMove, name: string, since: string): MoverRow {
  const flows: readonly (readonly [string, number])[] = [
    ["Income", move.incomeMinor],
    ["Spending", move.spendingMinor],
    ["Transfers", move.transfersMinor],
    ["Trades", move.tradesMinor],
    ["Other", move.otherMinor],
  ];
  return {
    key: move.accountId,
    name,
    title: name,
    ...(move.driver ? { sub: `${move.driver.label} ${formatSignedMoney(move.driver.amountMinor)}` } : {}),
    valueMinor: move.changeMinor,
    tone: move.changeMinor > 0 ? "up" : "down",
    details: [
      [`Balance ${since}`, formatMoney(move.baselineMinor)],
      ...flows
        .filter(([label, valueMinor]) => label !== "Other" || Math.abs(valueMinor) >= 50)
        .map(([label, valueMinor]): DetailLine => {
          const tone = toneOf(valueMinor);
          return tone ? [label, formatSignedMoney(valueMinor), tone] : [label, formatSignedMoney(valueMinor)];
        }),
      ["Balance now", formatMoney(move.currentMinor)],
    ],
    note: "Balance change = income + spending + transfers + trades + other.",
  };
}

function spendingRow(category: MoneyCheckInSpendingCategory, since: string): MoverRow {
  return {
    key: category.category,
    name: <CategoryValue category={category.category} />,
    title: moneyCategoryLabel(category.category),
    ...(category.merchants[0] ? { sub: category.merchants[0].label } : {}),
    valueMinor: -category.currentMinor,
    tone: "down",
    details: [
      [`${since} → today`, formatMoney(category.currentMinor)],
      ...category.merchants.map((merchant): DetailLine => [merchant.label, formatMoney(merchant.amountMinor)]),
    ],
    note: "Top merchants in this category since the check-in.",
  };
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

function toneOf(valueMinor: number): Tone | undefined {
  return valueMinor > 0 ? "up" : valueMinor < 0 ? "down" : undefined;
}

function toneClass(tone: Tone) {
  return tone === "up" ? "text-emerald-400" : "text-rose-400";
}
