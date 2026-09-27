import type { ReactNode } from "react";
import { cn } from "../lib/utils.js";
import { Card } from "./ui/card.js";

/** One summary number with a sentence-case label, shared by the Publisher and Markdown Share overviews. */
export function MetricCard({ label, value, detail, attention = false }: { label: string; value: ReactNode; detail?: string; attention?: boolean }) {
  return <Card className="gap-0 p-4">
    <span className="text-xs text-muted-foreground">{label}</span>
    <strong className={cn("mt-1 text-2xl font-semibold tabular-nums", attention && "text-warning")}>{value}</strong>
    {detail ? <span className="mt-1 truncate text-xs text-muted-foreground">{detail}</span> : null}
  </Card>;
}
