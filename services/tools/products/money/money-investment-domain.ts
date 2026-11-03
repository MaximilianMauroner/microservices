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

export type MoneyOpenInvestmentPosition = Readonly<{
  accountKey: string;
  symbol: string;
  quantity: string;
  costBasisMinor: number;
}>;

export type MoneyInvestmentLotAnalytics = Readonly<{
  realized: MoneyRealizedGainAnalytics;
  openPositions: readonly MoneyOpenInvestmentPosition[];
}>;

type Lot = { quantity: bigint; costMinor: bigint };
const QUANTITY_SCALE = 1_000_000_000_000n;

/** Calculates realized performance from completed trades using FIFO lots. */
export function fifoRealizedGains(events: readonly MoneyRealizedGainEvent[]): MoneyRealizedGainAnalytics {
  return fifoInvestmentLots(events).realized;
}

/** Calculates realized performance and the remaining FIFO cost basis. */
export function fifoInvestmentLots(events: readonly MoneyRealizedGainEvent[]): MoneyInvestmentLotAnalytics {
  const lots = new Map<string, Lot[]>();
  const realized = new Map<string, { soldQuantity: bigint; saleCount: number; proceedsMinor: bigint; costBasisMinor: bigint }>();
  let unmatchedSaleCount = 0;
  const orderedEvents = [...events].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.sourceOrder.localeCompare(right.sourceOrder));
  const neutralTransfers = neutralPositionTransfers(orderedEvents);

  for (const event of orderedEvents) {
    if (neutralTransfers.has(event)) continue;
    if (!event.symbol || !event.quantity) continue;
    const symbol = event.symbol.trim();
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

    if (event.eventKind === "position_transfer" || event.eventKind === "delivery") {
      if (quantity > 0n) symbolLots.push({ quantity, costMinor: 0n });
      else consumeLots(symbolLots, -quantity);
      lots.set(lotKey, symbolLots);
      continue;
    }

    if (event.eventKind !== "sell" || quantity < 0n) continue;
    const saleQuantity = quantity;
    let remaining = saleQuantity;
    let costBasisMinor = 0n;
    ({ remaining, costBasisMinor } = consumeLots(symbolLots, saleQuantity));
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
  const realizedAnalytics = {
    positions,
    totals: {
      saleCount: positions.reduce((sum, item) => sum + item.saleCount, 0),
      proceedsMinor: positions.reduce((sum, item) => sum + item.proceedsMinor, 0),
      costBasisMinor: positions.reduce((sum, item) => sum + item.costBasisMinor, 0),
      gainMinor: positions.reduce((sum, item) => sum + item.gainMinor, 0),
      unmatchedSaleCount
    }
  };
  const openPositions = [...lots.entries()].flatMap(([lotKey, symbolLots]) => {
    const [accountKey, symbol] = lotKey.split("\0") as [string, string];
    const quantity = symbolLots.reduce((sum, lot) => sum + lot.quantity, 0n);
    if (quantity === 0n) return [];
    return [{
      accountKey,
      symbol,
      quantity: decimalQuantity(quantity),
      costBasisMinor: safeMinor(symbolLots.reduce((sum, lot) => sum + lot.costMinor, 0n))
    }];
  }).sort((left, right) => left.symbol.localeCompare(right.symbol) || left.accountKey.localeCompare(right.accountKey));
  return { realized: realizedAnalytics, openPositions };
}

/** Exact same-account transfer pairs are bookkeeping rows, not disposals or zero-cost acquisitions. */
function neutralPositionTransfers(events: readonly MoneyRealizedGainEvent[]) {
  const groups = new Map<string, { incoming: MoneyRealizedGainEvent[]; outgoing: MoneyRealizedGainEvent[] }>();
  for (const event of events) {
    if (event.eventKind !== "position_transfer" || !event.symbol || !event.quantity || event.baseAmountMinor !== 0 || event.baseFeeMinor !== 0) continue;
    const quantity = fixedQuantity(event.quantity);
    if (quantity === 0n) continue;
    const absoluteQuantity = quantity < 0n ? -quantity : quantity;
    const key = `${event.accountKey}\0${event.symbol.trim()}\0${event.occurredAt.slice(0, 10)}\0${absoluteQuantity}`;
    const group = groups.get(key) ?? { incoming: [], outgoing: [] };
    (quantity > 0n ? group.incoming : group.outgoing).push(event);
    groups.set(key, group);
  }
  const neutral = new Set<MoneyRealizedGainEvent>();
  for (const group of groups.values()) {
    const pairCount = Math.min(group.incoming.length, group.outgoing.length);
    for (let index = 0; index < pairCount; index += 1) {
      neutral.add(group.incoming[index]!);
      neutral.add(group.outgoing[index]!);
    }
  }
  return neutral;
}

function consumeLots(lots: Lot[], requestedQuantity: bigint) {
  let remaining = requestedQuantity;
  let costBasisMinor = 0n;
  while (remaining > 0n && lots.length) {
    const lot = lots[0]!;
    const consumed = remaining < lot.quantity ? remaining : lot.quantity;
    const consumedCost = consumed === lot.quantity ? lot.costMinor : proportionalMinor(lot.costMinor, consumed, lot.quantity);
    costBasisMinor += consumedCost;
    lot.quantity -= consumed;
    lot.costMinor -= consumedCost;
    remaining -= consumed;
    if (lot.quantity === 0n) lots.shift();
  }
  return { remaining, costBasisMinor };
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
