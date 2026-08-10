import type { MoneyInvestmentEventKind } from "./money-import-domain.js";

export type MoneyRealizedGainEvent = Readonly<{
  accountKey: string;
  occurredAt: string;
  sourceOrder: string;
  eventKind: MoneyInvestmentEventKind;
  symbol?: string;
  quantity?: string;
  baseAmountMinor: number;
  baseFeeMinor: number;
}>;

export type MoneyRealizedGainAnalytics = Readonly<{
  positions: readonly Readonly<{
    symbol: string;
    soldQuantity: string;
    saleCount: number;
    proceedsMinor: number;
    costBasisMinor: number;
    gainMinor: number;
  }>[];
  totals: Readonly<{
    saleCount: number;
    proceedsMinor: number;
    costBasisMinor: number;
    gainMinor: number;
    unmatchedSaleCount: number;
  }>;
}>;

type Lot = { quantity: bigint; costMinor: bigint };
const QUANTITY_SCALE = 1_000_000_000_000n;

/** Calculates realized performance from completed trades using FIFO lots. */
export function fifoRealizedGains(events: readonly MoneyRealizedGainEvent[]): MoneyRealizedGainAnalytics {
  const lots = new Map<string, Lot[]>();
  const realized = new Map<string, { soldQuantity: bigint; saleCount: number; proceedsMinor: bigint; costBasisMinor: bigint }>();
  let unmatchedSaleCount = 0;

  for (const event of [...events].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.sourceOrder.localeCompare(right.sourceOrder))) {
    if (!event.symbol || !event.quantity) continue;
    const symbol = event.symbol.trim().toLocaleUpperCase("en-GB");
    const quantity = fixedQuantity(event.quantity);
    if (!symbol || quantity === 0n) continue;
    const lotKey = `${event.accountKey}\0${symbol}`;
    const symbolLots = lots.get(lotKey) ?? [];

    if (event.eventKind === "buy") {
      if (quantity > 0n) symbolLots.push({ quantity, costMinor: BigInt(Math.abs(event.baseAmountMinor) + event.baseFeeMinor) });
      lots.set(lotKey, symbolLots);
      continue;
    }

    if (event.eventKind === "split") {
      if (quantity > 0n) applySplit(symbolLots, quantity);
      lots.set(lotKey, symbolLots);
      continue;
    }

    if (event.eventKind !== "sell" || quantity < 0n) continue;
    const saleQuantity = quantity;
    let remaining = saleQuantity;
    let costBasisMinor = 0n;
    while (remaining > 0n && symbolLots.length) {
      const lot = symbolLots[0]!;
      const consumed = remaining < lot.quantity ? remaining : lot.quantity;
      const consumedCost = consumed === lot.quantity ? lot.costMinor : proportionalMinor(lot.costMinor, consumed, lot.quantity);
      costBasisMinor += consumedCost;
      lot.quantity -= consumed;
      lot.costMinor -= consumedCost;
      remaining -= consumed;
      if (lot.quantity === 0n) symbolLots.shift();
    }
    lots.set(lotKey, symbolLots);
    const matchedQuantity = saleQuantity - remaining;
    if (remaining > 0n) unmatchedSaleCount += 1;
    if (matchedQuantity === 0n) continue;
    const netProceeds = BigInt(Math.abs(event.baseAmountMinor) - event.baseFeeMinor);
    const proceedsMinor = matchedQuantity === saleQuantity ? netProceeds : proportionalMinor(netProceeds, matchedQuantity, saleQuantity);
    const current = realized.get(symbol) ?? { soldQuantity: 0n, saleCount: 0, proceedsMinor: 0n, costBasisMinor: 0n };
    current.soldQuantity += matchedQuantity;
    current.saleCount += 1;
    current.proceedsMinor += proceedsMinor;
    current.costBasisMinor += costBasisMinor;
    realized.set(symbol, current);
  }

  const positions = [...realized.entries()].map(([symbol, item]) => ({
    symbol,
    soldQuantity: decimalQuantity(item.soldQuantity),
    saleCount: item.saleCount,
    proceedsMinor: safeMinor(item.proceedsMinor),
    costBasisMinor: safeMinor(item.costBasisMinor),
    gainMinor: safeMinor(item.proceedsMinor - item.costBasisMinor)
  })).sort((left, right) => Math.abs(right.gainMinor) - Math.abs(left.gainMinor) || left.symbol.localeCompare(right.symbol));
  return {
    positions,
    totals: {
      saleCount: positions.reduce((sum, item) => sum + item.saleCount, 0),
      proceedsMinor: positions.reduce((sum, item) => sum + item.proceedsMinor, 0),
      costBasisMinor: positions.reduce((sum, item) => sum + item.costBasisMinor, 0),
      gainMinor: positions.reduce((sum, item) => sum + item.gainMinor, 0),
      unmatchedSaleCount
    }
  };
}

function applySplit(lots: Lot[], addedQuantity: bigint) {
  const originalQuantity = lots.reduce((sum, lot) => sum + lot.quantity, 0n);
  if (originalQuantity <= 0n) return;
  let remainingAddition = addedQuantity;
  for (const [index, lot] of lots.entries()) {
    const addition = index === lots.length - 1 ? remainingAddition : lot.quantity * addedQuantity / originalQuantity;
    lot.quantity += addition;
    remainingAddition -= addition;
  }
}

function proportionalMinor(value: bigint, numerator: bigint, denominator: bigint) {
  return (value * numerator + denominator / 2n) / denominator;
}

function fixedQuantity(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error(`Invalid investment quantity ${JSON.stringify(value)}.`);
  const fraction = (match[3] ?? "").padEnd(12, "0");
  const result = BigInt(match[2]!) * QUANTITY_SCALE + BigInt(fraction || "0");
  return match[1] ? -result : result;
}

function decimalQuantity(value: bigint) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / QUANTITY_SCALE;
  const fraction = String(absolute % QUANTITY_SCALE).padStart(12, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function safeMinor(value: bigint) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error("Realized investment amount exceeds the supported range.");
  return result;
}
