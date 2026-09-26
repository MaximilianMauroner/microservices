import { fifoInvestmentLots } from "./money-investment-domain.js";
import { marketValueMinor, type MoneyFxRate } from "./money-market-data-domain.js";
import type { MoneyHistoricalPrice, MoneyMarketValuationEvent } from "./money-market-data-repository.js";

/** A check-in is a Europe/Berlin day with at least one committed statement import. */
export type MoneyCheckInPositionMove = Readonly<{
  canonicalKey: string;
  name: string;
  assetClass: string;
  baselineValueMinor: number;
  currentValueMinor: number;
  boughtMinor: number;
  soldMinor: number;
  moveMinor: number;
  returnPercent?: number;
  closed: boolean;
}>;

export type MoneyCheckInPositions = Readonly<{
  baseline: string;
  moves: readonly MoneyCheckInPositionMove[];
  unpricedNames: readonly string[];
}>;

export type MoneyCashSnapshotPoint = Readonly<{ accountId: string; date: string; valueMinor: number }>;

export type MoneyCashFlowDay = Readonly<{
  accountId: string;
  date: string;
  incomeMinor: number;
  spendingMinor: number;
  transfersMinor: number;
  tradesMinor: number;
}>;

export type MoneyCheckInCashMove = Readonly<{
  accountId: string;
  baselineMinor: number;
  currentMinor: number;
  changeMinor: number;
  incomeMinor: number;
  spendingMinor: number;
  transfersMinor: number;
  tradesMinor: number;
  otherMinor: number;
}>;

export type MoneyCheckInCash = Readonly<{
  moves: readonly MoneyCheckInCashMove[];
  baselineTotalMinor: number;
  currentTotalMinor: number;
}>;

export type MoneyCheckIn = Readonly<{
  days: readonly string[];
  baseline: string;
  positions: readonly MoneyCheckInPositionMove[];
  unpricedNames: readonly string[];
  cash: readonly MoneyCheckInCashMove[];
  bridge: Readonly<{
    baselineNetWorthMinor: number;
    marketMinor: number;
    incomeMinor: number;
    spendingMinor: number;
    otherMinor: number;
    currentNetWorthMinor: number;
  }>;
}>;

/** Uses the requested check-in when it exists, otherwise the one before the latest upload. */
export function checkInBaseline(days: readonly string[], requested?: string) {
  if (requested && days.includes(requested)) return requested;
  return days.at(-2) ?? days.at(-1);
}

/**
 * Separates market movement from money added or withdrawn:
 * move = value now - value at the baseline close - bought + sold.
 */
export function positionMovesSince(input: Readonly<{
  baseline: string;
  events: readonly MoneyMarketValuationEvent[];
  prices: readonly MoneyHistoricalPrice[];
  usdRates: readonly MoneyFxRate[];
  current: readonly Readonly<{ canonicalKey: string; name: string; assetClass: string; marketValueMinor?: number }>[];
}>): MoneyCheckInPositions {
  const valueOn = historicalValuer(input.prices, input.usdRates);
  const items = new Map<string, { name: string; assetClass: string; baseline: number; bought: number; sold: number; unpriced: boolean }>();
  const item = (event: Pick<MoneyMarketValuationEvent, "canonicalKey" | "name" | "assetClass">) => {
    const current = items.get(event.canonicalKey) ?? { name: event.name, assetClass: event.assetClass, baseline: 0, bought: 0, sold: 0, unpriced: false };
    items.set(event.canonicalKey, current);
    return current;
  };
  const names = new Map(input.events.map((event) => [event.canonicalKey, event]));

  const held = input.events.filter((event) => event.localDate <= input.baseline);
  for (const position of fifoInvestmentLots(held.map(lotEvent)).openPositions) {
    const target = item(names.get(position.symbol)!);
    const value = valueOn(position.symbol, position.quantity, input.baseline);
    if (value === undefined) target.unpriced = true;
    else target.baseline += value;
  }

  for (const event of input.events) {
    if (event.localDate <= input.baseline) continue;
    if (event.eventKind === "buy") item(event).bought += Math.abs(event.baseAmountMinor) + event.baseFeeMinor;
    if (event.eventKind === "sell") item(event).sold += Math.abs(event.baseAmountMinor) - event.baseFeeMinor;
    if ((event.eventKind === "position_transfer" || event.eventKind === "delivery") && event.quantity) {
      // Securities moved in or out without cash count as money added or withdrawn at that day's close.
      const target = item(event);
      const quantity = event.quantity.replace(/^-/, "");
      const value = valueOn(event.canonicalKey, quantity, event.localDate);
      if (value === undefined) target.unpriced = true;
      else if (event.quantity.startsWith("-")) target.sold += value;
      else target.bought += value;
    }
  }

  const current = new Map(input.current.map((position) => [position.canonicalKey, position]));
  for (const position of input.current) {
    const target = item(position);
    target.name = position.name;
    target.assetClass = position.assetClass;
  }

  const moves: MoneyCheckInPositionMove[] = [];
  const unpricedNames: string[] = [];
  for (const [canonicalKey, value] of items) {
    const now = current.get(canonicalKey);
    if (value.unpriced || (now && now.marketValueMinor === undefined)) {
      unpricedNames.push(value.name);
      continue;
    }
    const currentValueMinor = now?.marketValueMinor ?? 0;
    if (!value.baseline && !value.bought && !value.sold && !currentValueMinor) continue;
    const moveMinor = currentValueMinor - value.baseline - value.bought + value.sold;
    const invested = value.baseline + value.bought;
    moves.push({
      canonicalKey,
      name: value.name,
      assetClass: value.assetClass,
      baselineValueMinor: value.baseline,
      currentValueMinor,
      boughtMinor: value.bought,
      soldMinor: value.sold,
      moveMinor,
      ...(invested > 0 ? { returnPercent: (moveMinor / invested) * 100 } : {}),
      closed: !now
    });
  }
  moves.sort((left, right) => right.moveMinor - left.moveMinor || left.name.localeCompare(right.name));
  return { baseline: input.baseline, moves, unpricedNames: unpricedNames.sort() };
}

/** Explains each cash account's balance change between its last snapshot at the baseline and its latest snapshot. */
export function cashMovesSince(input: Readonly<{
  baseline: string;
  snapshots: readonly MoneyCashSnapshotPoint[];
  flows: readonly MoneyCashFlowDay[];
}>): MoneyCheckInCash {
  const byAccount = groupByKey([...input.snapshots].sort((left, right) => left.date.localeCompare(right.date)), (point) => point.accountId);
  const moves: MoneyCheckInCashMove[] = [];
  let baselineTotalMinor = 0;
  let currentTotalMinor = 0;
  for (const [accountId, points] of byAccount) {
    const start = points.findLast((point) => point.date <= input.baseline);
    const end = points.at(-1)!;
    baselineTotalMinor += start?.valueMinor ?? 0;
    currentTotalMinor += end.valueMinor;
    if (end === start) continue;
    const flows = input.flows.filter((flow) => flow.accountId === accountId && (!start || flow.date > start.date) && flow.date <= end.date);
    const sum = (key: "incomeMinor" | "spendingMinor" | "transfersMinor" | "tradesMinor") => flows.reduce((total, flow) => total + flow[key], 0);
    const baselineMinor = start?.valueMinor ?? 0;
    const changeMinor = end.valueMinor - baselineMinor;
    const incomeMinor = sum("incomeMinor");
    const spendingMinor = sum("spendingMinor");
    const transfersMinor = sum("transfersMinor");
    const tradesMinor = sum("tradesMinor");
    moves.push({
      accountId,
      baselineMinor,
      currentMinor: end.valueMinor,
      changeMinor,
      incomeMinor,
      spendingMinor,
      transfersMinor,
      tradesMinor,
      otherMinor: changeMinor - incomeMinor - spendingMinor - transfersMinor - tradesMinor
    });
  }
  moves.sort((left, right) => right.changeMinor - left.changeMinor || left.accountId.localeCompare(right.accountId));
  return { moves, baselineTotalMinor, currentTotalMinor };
}

/** Builds the net worth bridge. Other holds what the classified flows do not explain. */
export function moneyCheckIn(input: Readonly<{ days: readonly string[]; positions: MoneyCheckInPositions; cash: MoneyCheckInCash }>): MoneyCheckIn {
  const { positions, cash } = input;
  const baselineNetWorthMinor = cash.baselineTotalMinor + positions.moves.reduce((sum, move) => sum + move.baselineValueMinor, 0);
  const currentNetWorthMinor = cash.currentTotalMinor + positions.moves.reduce((sum, move) => sum + move.currentValueMinor, 0);
  const marketMinor = positions.moves.reduce((sum, move) => sum + move.moveMinor, 0);
  const incomeMinor = cash.moves.reduce((sum, move) => sum + move.incomeMinor, 0);
  const spendingMinor = cash.moves.reduce((sum, move) => sum + move.spendingMinor, 0);
  return {
    days: input.days,
    baseline: positions.baseline,
    positions: positions.moves,
    unpricedNames: positions.unpricedNames,
    cash: cash.moves,
    bridge: {
      baselineNetWorthMinor,
      marketMinor,
      incomeMinor,
      spendingMinor,
      otherMinor: currentNetWorthMinor - baselineNetWorthMinor - marketMinor - incomeMinor - spendingMinor,
      currentNetWorthMinor
    }
  };
}

export function lotEvent(event: MoneyMarketValuationEvent) {
  return {
    accountKey: event.accountKey,
    occurredAt: event.occurredAt,
    sourceOrder: event.sourceOrder,
    eventKind: event.eventKind,
    symbol: event.canonicalKey,
    ...(event.quantity ? { quantity: event.quantity } : {}),
    baseAmountMinor: event.baseAmountMinor,
    baseFeeMinor: event.baseFeeMinor
  };
}

function historicalValuer(prices: readonly MoneyHistoricalPrice[], usdRates: readonly MoneyFxRate[]) {
  const byKey = groupByKey([...prices].sort((left, right) => left.date.localeCompare(right.date)), (price) => price.canonicalKey);
  const rates = [...usdRates].sort((left, right) => left.date.localeCompare(right.date));
  return (canonicalKey: string, quantity: string, date: string) => {
    const price = byKey.get(canonicalKey)?.findLast((candidate) => candidate.date <= date);
    if (!price) return undefined;
    if (price.currency === "EUR") return marketValueMinor(quantity, price.close);
    const rate = rates.findLast((candidate) => candidate.date <= date);
    return rate ? marketValueMinor(quantity, price.close, rate.quotePerEuro) : undefined;
  };
}

function groupByKey<T>(items: readonly T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}
