"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { Button } from "../src/components/ui/button.js";
import { Input } from "../src/components/ui/input.js";

export type MoneySortDirection = "asc" | "desc";
export type MoneySort<Key extends string> = Readonly<{ key: Key; direction: MoneySortDirection }>;

export function MoneySortableHead<Key extends string>({ label, sortKey, active, onSort, align = "left", className = "" }: Readonly<{ label: string; sortKey: Key; active: MoneySort<Key>; onSort: (key: Key) => void; align?: "left" | "right"; className?: string }>) {
  const Icon = active.key !== sortKey ? ArrowUpDown : active.direction === "asc" ? ArrowUp : ArrowDown;
  return <th className={`px-2 py-1 ${align === "right" ? "text-right" : "text-left"} ${className}`} aria-sort={active.key === sortKey ? active.direction === "asc" ? "ascending" : "descending" : "none"}><Button type="button" variant="ghost" size="sm" className={`h-8 px-2 text-xs text-muted-foreground hover:text-foreground ${align === "right" ? "ml-auto" : "-ml-2"}`} onClick={() => onSort(sortKey)}>{label}<Icon className="size-3.5" /></Button></th>;
}

export function MoneyTableSearch({ value, onValue, placeholder, className = "" }: Readonly<{ value: string; onValue: (value: string) => void; placeholder: string; className?: string }>) {
  return <label className={`relative w-full sm:max-w-xs ${className}`}><span className="sr-only">{placeholder}</span><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input type="search" value={value} onChange={(event) => onValue(event.currentTarget.value)} placeholder={placeholder} className="pl-8" /></label>;
}

export function nextMoneySort<Key extends string>(current: MoneySort<Key>, key: Key, ascendingKeys: readonly Key[] = []): MoneySort<Key> {
  if (current.key === key) return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  return { key, direction: ascendingKeys.includes(key) ? "asc" : "desc" };
}

export function compareMoneyValues(left: string | number | undefined, right: string | number | undefined, direction: MoneySortDirection) {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  const compared = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "en-GB", { numeric: true });
  return direction === "asc" ? compared : -compared;
}
