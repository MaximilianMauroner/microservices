"use client";

import { ChevronRight } from "lucide-react";

/** Shared affordance for rows that navigate, keeping read-only data rows visually quiet. */
export const MONEY_ROW_ACTION_CLASS = "group cursor-pointer transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

export function MoneyRowActionCue({ label }: { label?: string }) {
  return <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground group-hover:text-foreground">{label ? <span>{label}</span> : null}<ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>;
}
