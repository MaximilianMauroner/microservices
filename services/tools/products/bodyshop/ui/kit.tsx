import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { AppShell } from "../../../platform/ui/components/app-shell.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../platform/ui/components/ui/dialog.js";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "../../../platform/ui/components/ui/drawer.js";
import { toast } from "../../../platform/ui/components/ui/toast.js";
import { useIsMobile } from "../../../platform/ui/components/ui/use-mobile.js";
import { cn } from "../../../platform/ui/lib/utils.js";
import { type BodyshopAction, runBodyshopAction } from "../server-functions.js";

/** The frame of every Bodyshop page: the shell and the page width. */
export function BodyshopLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppShell product="Bodyshop" />
      <main id="main" className="tools-page bodyshop-page pb-16">{children}</main>
    </>
  );
}

export function BodyshopPage({ title, facts, actions, children }: { title: ReactNode; facts?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-semibold tracking-tight text-[1.75rem] leading-tight sm:text-[2.25rem]">{title}</h1>
          {facts ? <p className="mt-1 text-sm text-muted-foreground">{facts}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </>
  );
}

/** The server's message for a failed change. */
export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) {
    try {
      const parsed = JSON.parse(error.message) as unknown;
      if (Array.isArray(parsed) && parsed[0] && typeof parsed[0].message === "string") return parsed[0].message;
    } catch { /* plain message */ }
    return error.message;
  }
  return "Try again.";
}

/** Runs one change, reloads the page data, and shows the result. */
export function useBodyshopAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function run(action: BodyshopAction, done?: string): Promise<{ id?: string; repeated?: number } | undefined> {
    setPending(true);
    try {
      const result = await runBodyshopAction({ data: action });
      await router.invalidate();
      if (result.repeated) toast.add({ title: "Already logged", description: "The same food was logged in the last ten minutes. Bodyshop kept one entry.", type: "info" });
      else if (done) toast.add({ title: done, type: "success" });
      return result;
    } catch (error) {
      toast.add({ title: "That did not work", description: messageOf(error), type: "error" });
      return undefined;
    } finally {
      setPending(false);
    }
  }
  return { run, pending };
}

/** A form surface: a bottom sheet on phones and a dialog on larger screens. */
export function Sheet({ open, onOpenChange, title, description, children, footer }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  const mobile = useIsMobile();
  const keyboard = useKeyboard(open && mobile);
  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
        <DrawerContent style={keyboard ? { marginBottom: keyboard.inset, maxHeight: keyboard.height - 8 } : undefined} className="max-h-[92dvh]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-xl font-semibold tracking-tight">{title}</DrawerTitle>
            {description ? <DrawerDescription>{description}</DrawerDescription> : null}
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">{children}</div>
          {footer ? <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</DrawerFooter> : null}
        </DrawerContent>
      </Drawer>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold tracking-tight">{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="-mx-1 min-h-0 overflow-y-auto px-1">{children}</div>
        {footer ? <DialogFooter>{footer}</DialogFooter> : <span />}
      </DialogContent>
    </Dialog>
  );
}

/** How much of the screen the on-screen keyboard covers, so a sheet can sit on top of it. */
function useKeyboard(active: boolean): { inset: number; height: number } | undefined {
  const [state, setState] = useState<{ inset: number; height: number }>();
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setState(inset > 80 ? { inset, height: viewport.height } : undefined);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      setState(undefined);
    };
  }, [active]);
  return state;
}

export function fmt(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return value.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function signed(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${fmt(Math.abs(value), digits)}`;
}

export function percent(share: number | null | undefined): string {
  return share === null || share === undefined ? "–" : `±${fmt(share * 100)} %`;
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export function dayLabel(day: string, today?: string): string {
  if (today && day === today) return "Today";
  if (today && Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`) === 86_400_000) return "Yesterday";
  return DAY_FORMAT.format(new Date(`${day}T00:00:00Z`));
}

export function shiftDay(day: string, count: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
}

/** The meaning colors. Everything else on a Bodyshop page is ink on the card surface. */
export const COLORS = { energy: "var(--bs-energy)", burn: "var(--bs-burn)", trend: "var(--bs-trend)", good: "var(--bs-good)", flag: "var(--bs-flag)" } as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A short day for chart axes, such as "21 Sep". */
export function shortDay(day: string): string {
  return `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
}

type Totals = Readonly<{ kcal: number; protein: number; carbs: number; fat: number; fiber: number | null }>;
type Bounds = Readonly<{ kcal: number | null }>;

/**
 * The day's food as a nutrition label: the calorie total with its range and the target, then one row per
 * nutrient. The range is drawn as a whisker under the bar, the same mark the charts use for a range.
 */
export function DayLabel({ totals, low, high, targets, known, status }: {
  totals: Totals; low: Bounds; high: Bounds; known: boolean; status: string;
  targets: Readonly<{ kcal: number; protein: number; carbs: number; fat: number; fiber: number }>;
}) {
  const scale = Math.max(targets.kcal * 1.2, (known && high.kcal !== null ? high.kcal : totals.kcal) * 1.04, 1);
  const at = (value: number) => `${Math.max(0, Math.min(100, (value / scale) * 100))}%`;
  const over = totals.kcal > targets.kcal;
  const ranged = known && low.kcal !== null && high.kcal !== null;
  return (
    <section aria-label="Day total" className="bs-label rounded-lg bg-card px-4 pt-3 pb-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Day total</h2>
        <span className="text-sm" style={{ color: status === "Complete" ? COLORS.good : undefined }}>{status === "Complete" ? "Complete" : `${status} log`}</span>
      </div>
      <div className="bs-rule mt-2 flex items-end justify-between gap-3 pt-2">
        <p className="flex items-baseline gap-1.5">
          <span className="bs-figure text-[3.75rem]">{fmt(totals.kcal)}</span>
          <span className="text-sm font-medium">kcal</span>
        </p>
        <p className="pb-1.5 text-right text-sm text-muted-foreground">of <span className="bs-figure text-base text-foreground">{fmt(targets.kcal)}</span></p>
      </div>
      <div className="relative mt-2 mb-1 h-6" role="img" aria-label={`${fmt(totals.kcal)} of ${fmt(targets.kcal)} kcal${ranged ? `, range ${fmt(low.kcal)} to ${fmt(high.kcal)}` : ""}`}>
        <div className="absolute inset-x-0 top-0 h-2.5 rounded-sm bg-muted" />
        <div className="bs-fill absolute top-0 left-0 h-2.5 rounded-l-sm" style={{ width: at(Math.min(totals.kcal, targets.kcal)), background: COLORS.energy }} />
        {over ? <div className="bs-fill absolute top-0 h-2.5 rounded-r-sm" style={{ left: at(targets.kcal), width: `calc(${at(totals.kcal)} - ${at(targets.kcal)})`, background: COLORS.flag }} /> : null}
        <div className="absolute -top-1 h-[1.125rem] w-0.5 bg-foreground" style={{ left: `calc(${at(targets.kcal)} - 1px)` }} />
        {ranged ? (
          <div className="bs-fill absolute top-4 h-2 border-x-2 border-foreground/70" style={{ left: at(low.kcal!), width: `calc(${at(high.kcal!)} - ${at(low.kcal!)})` }}>
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-foreground/70" />
          </div>
        ) : null}
      </div>
      <p className="flex justify-between gap-3 text-sm">
        <span style={{ color: over ? COLORS.flag : undefined }}>{over ? `${fmt(totals.kcal - targets.kcal)} kcal over` : `${fmt(targets.kcal - totals.kcal)} kcal left`}</span>
        <span className="text-muted-foreground">{ranged ? `Range ${fmt(low.kcal)} to ${fmt(high.kcal)}` : "Range not known yet"}</span>
      </p>
      <dl className="bs-rule-heavy mt-2">
        <Nutrient label="Protein" value={totals.protein} target={targets.protein} first />
        <Nutrient label="Carbs" value={totals.carbs} target={targets.carbs} />
        <Nutrient label="Fat" value={totals.fat} target={targets.fat} />
        <Nutrient label="Fiber" value={totals.fiber} target={targets.fiber} />
      </dl>
      {!ranged && totals.kcal > 0 ? <p className="bs-rule pt-1.5 text-xs text-muted-foreground">Fiber and the range show once every entry passes its checks.</p> : null}
    </section>
  );
}

function Nutrient({ label, value, target, first }: { label: string; value: number | null; target: number; first?: boolean }) {
  const share = value === null || target <= 0 ? 0 : Math.min(1, value / target);
  return (
    <div className={cn("grid grid-cols-[4.25rem_6.25rem_minmax(0,1fr)] items-center gap-x-3 py-1.5", !first && "bs-rule")}>
      <dt className="text-sm font-medium">{label}</dt>
      <dd className="text-right"><span className="bs-figure text-lg">{fmt(value)}</span><span className="text-xs text-muted-foreground"> / {fmt(target)} g</span></dd>
      <dd aria-hidden className="h-1.5 rounded-full bg-muted"><div className="bs-fill h-full rounded-full bg-foreground/80" style={{ width: `${share * 100}%` }} /></dd>
    </div>
  );
}

/** A chart tooltip: the day, then one row per series with its color and value. */
export function ChartTip({ active, label, rows }: { active?: boolean; label?: string; rows: readonly { color: string; name: string; value: string; dashed?: boolean }[] }) {
  if (!active || !label || !rows.length) return null;
  return (
    <div className="min-w-40 rounded-md border border-(--surface-border) bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{dayLabel(label)}</p>
      {rows.map((row) => (
        <p key={row.name} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span aria-hidden className="inline-block h-0.5 w-3" style={{ background: row.color, borderTop: row.dashed ? `2px dashed ${row.color}` : undefined }} />{row.name}
          </span>
          <span className="bs-figure text-sm">{row.value}</span>
        </p>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("grid gap-1.5 text-sm", className)}>
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/** A number input value: empty is null, anything else must parse. */
export function numberOrNull(text: string): number | null {
  const value = Number(text.replace(",", "."));
  return text.trim() === "" || !Number.isFinite(value) ? null : value;
}
