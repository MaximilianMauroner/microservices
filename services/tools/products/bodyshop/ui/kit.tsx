import { favicons } from "../../../platform/ui/favicons.js";
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
      <AppShell product="Bodyshop" icon={favicons.bodyshop} />
      <main id="main" className="tools-page bodyshop-page pb-16">{children}</main>
    </>
  );
}

export function BodyshopPage({ title, facts, actions, children }: { title: ReactNode; facts?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="bs-title text-[1.75rem]">{title}</h1>
          {facts ? <p className="bs-quiet mt-1.5 max-w-[60ch] text-sm">{facts}</p> : null}
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
        <DrawerContent style={keyboard ? { marginBottom: keyboard.inset, maxHeight: keyboard.height - 8 } : undefined} className="bodyshop-surface max-h-[92dvh]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="bs-title text-[1.375rem]">{title}</DrawerTitle>
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
      <DialogContent className="bodyshop-surface max-h-[88dvh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="bs-title text-[1.375rem]">{title}</DialogTitle>
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

/** The meaning colors. Everything else on a Bodyshop page is ink and quiet text on the page. */
export const COLORS = { energy: "var(--bs-energy)", burn: "var(--bs-burn)", trend: "var(--bs-trend)", flag: "var(--bs-flag)", quiet: "var(--bs-quiet)" } as const;

/** One step of amber per meal, the same on the day bar, in the meal list, and in the meal share. */
export const MEAL_COLORS: Readonly<Record<string, string>> = {
  Breakfast: "var(--bs-meal-breakfast)", Lunch: "var(--bs-meal-lunch)", Dinner: "var(--bs-meal-dinner)", Snack: "var(--bs-meal-snack)", Other: "var(--bs-meal-other)"
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A short day for chart axes, such as "21 Sep". */
export function shortDay(day: string): string {
  return `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
}

/** Why a day counts as complete or not, in words. The model keeps the workbook's own wording for parity. */
export function statusReason(basis: string | undefined, status: string): string {
  if (!basis) return "Log breakfast, lunch, and dinner, or mark the day complete.";
  if (basis.startsWith("Manual override")) return `You set this day to ${status.toLowerCase()}.`;
  if (basis.startsWith("Recorded Complete")) return "You marked this day complete.";
  if (basis.startsWith("Automatic")) return "Breakfast, lunch, and dinner are logged, so the day counts as complete.";
  return "Log breakfast, lunch, and dinner, or mark the day complete.";
}

type Totals = Readonly<{ kcal: number; protein: number; carbs: number; fat: number; fiber: number | null }>;
type Bounds = Readonly<{ kcal: number | null }>;

/**
 * The day's energy budget: what is left in large figures, then one bar split into the meals in their order,
 * with the target as a tick and the likely range as a bracket under the bar. Macros follow in four columns.
 */
export function DayBudget({ totals, low, high, targets, known, meals }: {
  totals: Totals; low: Bounds; high: Bounds; known: boolean; meals: readonly { meal: string; kcal: number }[];
  targets: Readonly<{ kcal: number; protein: number; carbs: number; fat: number; fiber: number }>;
}) {
  const ranged = known && low.kcal !== null && high.kcal !== null;
  const scale = Math.max(targets.kcal * 1.15, (ranged ? high.kcal! : totals.kcal) * 1.03, 1);
  const at = (value: number) => `${Math.max(0, Math.min(100, (value / scale) * 100))}%`;
  const over = totals.kcal > targets.kcal;
  const left = targets.kcal - totals.kcal;
  let start = 0;
  return (
    <section aria-label="Day total">
      <div className="flex items-end justify-between gap-4">
        <p className="min-w-0">
          <span className="bs-figure block text-[4.75rem] leading-[0.8] sm:text-[5.5rem]" style={{ color: over ? COLORS.flag : undefined }}>{fmt(Math.abs(left))}</span>
          <span className="mt-2 block text-[0.9375rem] font-medium">{over ? "kcal over target" : "kcal left"}</span>
        </p>
        <p className="bs-quiet shrink-0 pb-0.5 text-right text-sm leading-snug">
          <span className="bs-figure text-[1.375rem] text-foreground">{fmt(totals.kcal)}</span> eaten
          <span className="block">of <span className="bs-figure text-base text-foreground">{fmt(targets.kcal)}</span></span>
        </p>
      </div>

      <div className="relative mt-5 h-9" role="img" aria-label={`${fmt(totals.kcal)} of ${fmt(targets.kcal)} kcal: ${meals.filter((one) => one.kcal > 0).map((one) => `${one.meal} ${fmt(one.kcal)}`).join(", ") || "nothing logged"}${ranged ? `. Likely ${fmt(low.kcal)} to ${fmt(high.kcal)}` : ""}`}>
        <div className="absolute inset-x-0 top-0 h-4 rounded-[5px] bg-(--bs-line)" />
        {meals.map((one) => {
          if (one.kcal <= 0) return null;
          const from = start;
          start += one.kcal;
          return <div key={one.meal} className="bs-fill absolute top-0 h-4 border-r-2 border-background first:rounded-l-[5px]" style={{ left: at(from), width: at(one.kcal), background: MEAL_COLORS[one.meal] }} />;
        })}
        {over ? <div className="bs-fill absolute top-0 h-4 opacity-90" style={{ left: at(targets.kcal), width: `calc(${at(totals.kcal)} - ${at(targets.kcal)})`, background: `repeating-linear-gradient(135deg, ${COLORS.flag} 0 2px, transparent 2px 5px)` }} /> : null}
        <div className="absolute -top-1.5 h-7 w-[3px] rounded-full bg-foreground" style={{ left: `calc(${at(targets.kcal)} - 1.5px)` }} />
        {ranged ? (
          <div className="bs-fill absolute top-6 h-2 border-x-[1.5px] border-(--bs-quiet)" style={{ left: at(low.kcal!), width: `calc(${at(high.kcal!)} - ${at(low.kcal!)})` }}>
            <div className="absolute inset-x-0 top-1/2 h-[1.5px] -translate-y-1/2 bg-(--bs-quiet)" />
          </div>
        ) : null}
      </div>
      <p className="bs-quiet -mt-1 text-[0.8125rem]">
        {ranged ? <>Likely <span className="bs-figure text-sm text-foreground">{fmt(low.kcal)}</span> to <span className="bs-figure text-sm text-foreground">{fmt(high.kcal)}</span> kcal</> : totals.kcal > 0 ? "The likely range shows once every entry passes its checks." : "Nothing logged yet."}
      </p>

      <dl className="mt-6 grid grid-cols-4 gap-3">
        <Macro label="Protein" value={totals.protein} target={targets.protein} />
        <Macro label="Carbs" value={totals.carbs} target={targets.carbs} />
        <Macro label="Fat" value={totals.fat} target={targets.fat} />
        <Macro label="Fiber" value={totals.fiber} target={targets.fiber} />
      </dl>
    </section>
  );
}

function Macro({ label, value, target }: { label: string; value: number | null; target: number }) {
  const share = value === null || target <= 0 ? 0 : Math.min(1, value / target);
  return (
    <div className="min-w-0">
      <dt className="bs-quiet text-[0.8125rem]">{label}</dt>
      <dd className="mt-1 truncate"><span className="bs-figure text-[1.5rem]">{fmt(value)}</span><span className="bs-quiet text-xs"> / {fmt(target)} g</span></dd>
      <dd aria-hidden className="mt-1.5 h-1 rounded-full bg-(--bs-line)"><div className="bs-fill h-full rounded-full bg-foreground" style={{ width: `${share * 100}%` }} /></dd>
    </div>
  );
}

/** A chart tooltip: the day, then one row per series with its color and value. */
export function ChartTip({ active, label, rows }: { active?: boolean; label?: string; rows: readonly { color: string; name: string; value: string; dashed?: boolean }[] }) {
  if (!active || !label || !rows.length) return null;
  return (
    <div className="min-w-44 rounded-xl border border-(--bs-line) bg-popover px-3 py-2.5 text-xs shadow-[0_8px_24px_rgb(0_0_0/25%)]">
      <p className="mb-1.5 font-semibold">{dayLabel(label)}</p>
      {rows.map((row) => (
        <p key={row.name} className="flex items-center justify-between gap-4 py-0.5">
          <span className="bs-quiet flex items-center gap-1.5">
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
      {hint ? <span className="bs-quiet text-xs">{hint}</span> : null}
    </label>
  );
}

/** A number input value: empty is null, anything else must parse. */
export function numberOrNull(text: string): number | null {
  const value = Number(text.replace(",", "."));
  return text.trim() === "" || !Number.isFinite(value) ? null : value;
}
