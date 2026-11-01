"use client";

import { useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "../src/components/ui/alert-dialog.js";
import { Badge } from "../src/components/ui/badge.js";
import { Button } from "../src/components/ui/button.js";
import { cn } from "../src/lib/utils.js";
import type { FeedbackFormStatus } from "./domain.js";

/** Asks before a destructive or disruptive action. Stays open and shows the error when the action fails. */
export function ConfirmDialog({ open, onOpenChange, title, description, action, destructive = false, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  action: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function confirm() {
    setBusy(true); setError(undefined);
    try { await onConfirm(); onOpenChange(false); } catch (caught) { setError(feedbackErrorMessage(caught)); } finally { setBusy(false); }
  }
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!busy) { setError(undefined); onOpenChange(next); } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant={destructive ? "destructive" : "default"} disabled={busy} onClick={() => void confirm()}>{action}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function FormStatusBadge({ status }: { status: FeedbackFormStatus }) {
  return <Badge variant={status === "active" ? "positive" : "outline"}>{status === "active" ? "Active" : status === "draft" ? "Draft" : "Closed"}</Badge>;
}

/** A small count, amber when it asks for attention and muted otherwise. */
export function CountBadge({ count, tone = "attention", className }: { count: number; tone?: "attention" | "muted"; className?: string }) {
  return <span className={cn("inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-xs font-semibold tabular-nums", tone === "attention" ? "bg-warning/15 text-warning" : "text-muted-foreground", className)}>{count.toLocaleString("en-GB")}</span>;
}

export function feedbackErrorMessage(error: unknown) { return error instanceof Error ? error.message : "The feedback action failed."; }

const TIME_ZONE = "Europe/Berlin";
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, weekday: "short" });
const dayMonth = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, day: "numeric", month: "short" });
const dayMonthYear = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, day: "numeric", month: "short", year: "numeric" });
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });

/** "Today", "Yesterday", "Thu" within a week, then "20 Sep", or "20 Sep 2025" in an earlier year. Berlin days, like formatDateTime. */
export function formatRecentDay(value: string, now = new Date()) {
  const date = new Date(value);
  const days = Math.round((Date.parse(dayKey.format(now)) - Date.parse(dayKey.format(date))) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return weekday.format(date);
  return dayKey.format(date).slice(0, 4) === dayKey.format(now).slice(0, 4) ? dayMonth.format(date) : dayMonthYear.format(date);
}

/** Like formatRecentDay, but today shows the time: "08:41". */
export function formatInboxTime(value: string, now = new Date()) {
  const day = formatRecentDay(value, now);
  return day === "Today" ? clock.format(new Date(value)) : day;
}
