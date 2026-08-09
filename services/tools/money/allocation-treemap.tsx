import type { MoneyTrackerAccountCategory } from "./money-tracker-domain.js";

export type AllocationTreemapAccount = Readonly<{
  name: string;
  value: number;
  category: MoneyTrackerAccountCategory;
}>;

export type TreemapTile = AllocationTreemapAccount & Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  share: number;
}>;

type Rectangle = Readonly<{ x: number; y: number; width: number; height: number }>;

const preciseCurrency = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

/** Displays account share as a compact, area-proportional map. */
export function AllocationTreemap({ accounts }: { accounts: readonly AllocationTreemapAccount[] }) {
  const tiles = buildAllocationTreemap(accounts);
  if (!tiles.length) {
    return <div className="grid h-72 place-items-center rounded-md border border-dashed bg-muted/35 text-sm text-muted-foreground">No positive balances to allocate.</div>;
  }

  return <div
    className="relative h-80 overflow-hidden rounded-lg border bg-muted/35 sm:h-96"
    role="img"
    aria-label={`Balance allocation. ${tiles.map((tile) => `${tile.name}: ${preciseCurrency.format(tile.value)}, ${tile.share.toFixed(1)} percent`).join(". ")}.`}
  >
    {tiles.map((tile) => {
      const compact = tile.width < 22 || tile.height < 22;
      return <div
        key={tile.name}
        className={`absolute overflow-hidden rounded-md border p-3 transition-colors hover:brightness-110 ${tile.category === "stocks" ? "allocation-tile--stocks" : "allocation-tile--cash"}`}
        style={{ left: `${tile.x}%`, top: `${tile.y}%`, width: `${tile.width}%`, height: `${tile.height}%` }}
        title={`${tile.name}: ${preciseCurrency.format(tile.value)} · ${tile.share.toFixed(1)}%`}
      >
        <div className="flex h-full min-h-0 flex-col justify-end">
          <strong className="truncate text-sm">{tile.name}</strong>
          {compact ? null : <span className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{preciseCurrency.format(tile.value)} · {tile.share.toFixed(1)}%</span>}
        </div>
      </div>;
    })}
  </div>;
}

export function buildAllocationTreemap(accounts: readonly AllocationTreemapAccount[]): TreemapTile[] {
  const included = accounts.filter((account) => account.value > 0).sort((left, right) => right.value - left.value);
  const total = included.reduce((sum, account) => sum + account.value, 0);
  if (!total) return [];

  return layout(included, { x: 0, y: 0, width: 100, height: 100 }, total)
    .map(({ account, rectangle }) => ({ ...account, ...rectangle, share: account.value / total * 100 }));
}

function layout(accounts: readonly AllocationTreemapAccount[], rectangle: Rectangle, total: number): Array<{ account: AllocationTreemapAccount; rectangle: Rectangle }> {
  if (accounts.length === 1) return [{ account: accounts[0]!, rectangle }];

  let leftTotal = 0;
  let splitIndex = 0;
  while (splitIndex < accounts.length - 1 && leftTotal + accounts[splitIndex]!.value <= total / 2) {
    leftTotal += accounts[splitIndex]!.value;
    splitIndex += 1;
  }
  if (splitIndex === 0) {
    leftTotal = accounts[0]!.value;
    splitIndex = 1;
  }

  const ratio = leftTotal / total;
  const horizontal = rectangle.width >= rectangle.height;
  const first: Rectangle = horizontal
    ? { ...rectangle, width: rectangle.width * ratio }
    : { ...rectangle, height: rectangle.height * ratio };
  const second: Rectangle = horizontal
    ? { x: rectangle.x + first.width, y: rectangle.y, width: rectangle.width - first.width, height: rectangle.height }
    : { x: rectangle.x, y: rectangle.y + first.height, width: rectangle.width, height: rectangle.height - first.height };

  return [
    ...layout(accounts.slice(0, splitIndex), first, leftTotal),
    ...layout(accounts.slice(splitIndex), second, total - leftTotal)
  ];
}
