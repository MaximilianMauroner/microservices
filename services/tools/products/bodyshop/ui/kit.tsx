import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { AppleIcon, type LucideIcon, SlidersHorizontalIcon, SunIcon, TrendingDownIcon } from "lucide-react";
import { createContext, type CSSProperties, type ReactNode, useContext, useEffect, useState } from "react";
import { AppShell } from "../../../platform/ui/components/app-shell.js";
import { favicons } from "../../../platform/ui/favicons.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../platform/ui/components/ui/dialog.js";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "../../../platform/ui/components/ui/drawer.js";
import { toast } from "../../../platform/ui/components/ui/toast.js";
import { useIsMobile } from "../../../platform/ui/components/ui/use-mobile.js";
import { cn } from "../../../platform/ui/lib/utils.js";
import { type BodyshopAction, runBodyshopAction } from "../server-functions.js";

type Page = Readonly<{ to: "/bodyshop" | "/bodyshop/progress" | "/bodyshop/foods" | "/bodyshop/settings"; label: string; icon: LucideIcon; hue: string }>;

/** The Bodyshop pages. Each has a hue for its badge, its tab, and its main buttons. */
const PAGES: readonly Page[] = [
  { to: "/bodyshop", label: "Today", icon: SunIcon, hue: "var(--bs-today)" },
  { to: "/bodyshop/progress", label: "Progress", icon: TrendingDownIcon, hue: "var(--bs-progress)" },
  { to: "/bodyshop/foods", label: "Foods", icon: AppleIcon, hue: "var(--bs-foods)" },
  { to: "/bodyshop/settings", label: "Settings", icon: SlidersHorizontalIcon, hue: "var(--bs-settings)" }
];

const OpenPage = createContext<Page>(PAGES[0]!);
const hue = (page: Page) => ({ "--bs-hue": page.hue }) as CSSProperties;

/** The frame of every Bodyshop page: the shell, tabs on top for wide screens and at the bottom for phones. */
export function BodyshopLayout({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const open = PAGES.slice(1).find((page) => pathname.startsWith(page.to)) ?? PAGES[0]!;
  return (
    <>
      <AppShell product="Bodyshop" icon={favicons.bodyshop} />
      <main id="main" style={hue(open)} className="tools-page bodyshop-page pb-32 md:pb-16">
        <nav aria-label="Bodyshop pages" className="mb-5 hidden md:block">
          <ul className="flex gap-1">
            {PAGES.map((page) => (
              <li key={page.to}>
                <Link to={page.to} activeOptions={{ exact: page.to === "/bodyshop", includeSearch: false }} preload="intent" style={hue(page)}
                  className="inline-flex h-9 items-center gap-1.5 px-2.5 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none aria-[current=page]:text-foreground aria-[current=page]:shadow-[inset_0_-3px_0_var(--bs-hue)]">
                  <page.icon className="size-4 text-(--bs-hue)" aria-hidden />{page.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <OpenPage.Provider value={open}>{children}</OpenPage.Provider>
      </main>
      <nav aria-label="Bodyshop pages" className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid grid-cols-4">
          {PAGES.map((page) => (
            <li key={page.to}>
              <Link to={page.to} activeOptions={{ exact: page.to === "/bodyshop", includeSearch: false }} preload="intent" style={hue(page)}
                className="group flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-muted-foreground aria-[current=page]:text-foreground">
                <span className="grid h-7 w-12 place-items-center rounded-full text-(--bs-hue) transition-colors group-aria-[current=page]:bg-[color-mix(in_srgb,var(--bs-hue)_18%,transparent)]">
                  <page.icon className="size-[1.15rem]" aria-hidden />
                </span>
                {page.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

export function BodyshopPage({ title, facts, actions, children }: { title: ReactNode; facts?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const open = useContext(OpenPage);
  return (
    <>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="grid size-10 shrink-0 place-items-center self-start rounded-[0.875rem] bg-(--bs-hue) text-(--bs-on-hue)"><open.icon className="size-5" /></span>
          <div className="min-w-0">
            <h1 className="bs-title text-[1.875rem] leading-[1.05]">{title}</h1>
            {facts ? <p className="bs-quiet mt-1 max-w-[60ch] text-sm">{facts}</p> : null}
          </div>
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

/** The meaning colors: food eaten, energy burned, weight, a complete day, and a failed check or a day over target. */
export const COLORS = {
  energy: "var(--bs-energy)", burn: "var(--bs-burn)", trend: "var(--bs-weight)", good: "var(--bs-good)", flag: "var(--bs-flag)", quiet: "var(--bs-quiet)", partial: "var(--bs-partial)"
} as const;

export function tint(color: string, share = 14): CSSProperties {
  return { "--tint": color, "--tint-share": `${share}%` } as CSSProperties;
}

/** One food color per meal, the same on the day ring, the meal card, and the meal share. */
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

const R = 15.915;

/**
 * A ring with rounded ends. Each part takes its share of the full circle, clockwise from the top.
 * An optional outer arc marks a range in the same shares.
 */
export function Ring({ parts, size, width, range, label, children }: {
  parts: readonly { color: string; share: number }[]; size: number; width: number; range?: readonly [number, number] | null; label?: string; children?: ReactNode;
}) {
  const shown = parts.filter((part) => part.share > 0.002);
  const gap = shown.length > 1 ? width + 1.4 : width + 0.2;
  let offset = 25;
  const full = shown.length === 1 && shown[0]!.share >= 0.999;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="-2.5 -2.5 41 41" width={size} height={size} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
        <circle r={R} cx={18} cy={18} fill="none" stroke="var(--bs-track)" strokeWidth={width} />
        {shown.map((part, index) => {
          const share = Math.min(part.share, 1) * 100;
          const start = offset;
          offset -= share;
          return full
            ? <circle key={index} r={R} cx={18} cy={18} fill="none" stroke={part.color} strokeWidth={width} />
            : <circle key={index} className="bs-arc" r={R} cx={18} cy={18} fill="none" stroke={part.color} strokeWidth={width} strokeLinecap="round"
                strokeDasharray={`${Math.max(share - gap, 0.1)} ${100 - share + gap}`} strokeDashoffset={start - gap / 2} />;
        })}
        {range ? (
          <circle className="bs-arc" r={R + width / 2 + 1.7} cx={18} cy={18} fill="none" stroke="var(--foreground)" strokeOpacity={0.7} strokeWidth={1.4} strokeLinecap="round" pathLength={100}
            strokeDasharray={`${Math.max((range[1] - range[0]) * 100, 0.5)} ${100 - (range[1] - range[0]) * 100}`} strokeDashoffset={25 - range[0] * 100} />
        ) : null}
      </svg>
      {children ? <div className="absolute inset-0 grid place-content-center text-center">{children}</div> : null}
    </div>
  );
}

/**
 * The day on a plate: one ring that fills meal by meal against the calorie target, the calories left in the middle,
 * and the likely range as an outer arc. Four macro tiles follow, each in its own color.
 */
export function DayBudget({ totals, low, high, targets, known, meals }: {
  totals: Totals; low: Bounds; high: Bounds; known: boolean; meals: readonly { meal: string; kcal: number }[];
  targets: Readonly<{ kcal: number; protein: number; carbs: number; fat: number; fiber: number }>;
}) {
  const ranged = known && low.kcal !== null && high.kcal !== null;
  const over = totals.kcal > targets.kcal;
  const scale = Math.max(targets.kcal, totals.kcal, 1);
  const shown = meals.filter((one) => one.kcal > 0 || one.meal !== "Other");
  const summary = `${fmt(totals.kcal)} of ${fmt(targets.kcal)} kcal: ${meals.filter((one) => one.kcal > 0).map((one) => `${one.meal} ${fmt(one.kcal)}`).join(", ") || "nothing logged"}${ranged ? `. Likely ${fmt(low.kcal)} to ${fmt(high.kcal)}` : ""}`;
  return (
    <div className="grid gap-2.5">
      <section aria-label="Day total" className="bs-panel bs-plate px-4 pt-5 pb-4 text-center">
        <div className="flex justify-center">
          <Ring size={232} width={4.6} label={summary} parts={meals.map((one) => ({ color: MEAL_COLORS[one.meal]!, share: one.kcal / scale }))}
            range={ranged ? [Math.min(low.kcal! / scale, 1), Math.min(high.kcal! / scale, 1)] : null}>
            <span className="bs-figure text-[3.75rem]" style={{ color: over ? COLORS.flag : undefined }}>{fmt(Math.abs(targets.kcal - totals.kcal))}</span>
            <span className="bs-quiet mt-1 text-sm">{over ? "kcal over target" : "kcal left"}</span>
          </Ring>
        </div>
        <p className="mt-3 font-semibold">{fmt(totals.kcal)} of {fmt(targets.kcal)} kcal eaten</p>
        <p className="bs-quiet mt-0.5 flex items-center justify-center gap-1.5 text-[0.8125rem]">
          {ranged ? <><span aria-hidden className="h-1 w-4 rounded-full bg-foreground/70" />Likely {fmt(low.kcal)} to {fmt(high.kcal)}, shown by the outer arc</>
            : totals.kcal > 0 ? "The likely range shows once every entry passes its checks." : "Nothing logged yet."}
        </p>
        <ul className="mt-3.5 grid grid-cols-2 gap-2 text-left text-sm">
          {shown.map((one) => (
            <li key={one.meal} className="bs-panel flex items-center gap-2 rounded-xl px-2.5 py-2" style={tint(MEAL_COLORS[one.meal]!, 20)}>
              <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: MEAL_COLORS[one.meal] }} />{one.meal}
              <span className="bs-figure ml-auto text-[0.9375rem]">{one.kcal ? fmt(one.kcal) : "–"}</span>
            </li>
          ))}
        </ul>
      </section>
      <dl className="grid grid-cols-4 gap-2">
        <Macro label="Protein" color="var(--bs-protein)" value={totals.protein} target={targets.protein} />
        <Macro label="Carbs" color="var(--bs-carbs)" value={totals.carbs} target={targets.carbs} />
        <Macro label="Fat" color="var(--bs-fat)" value={totals.fat} target={targets.fat} />
        <Macro label="Fiber" color="var(--bs-fiber)" value={totals.fiber} target={targets.fiber} />
      </dl>
    </div>
  );
}

function Macro({ label, color, value, target }: { label: string; color: string; value: number | null; target: number }) {
  const share = value === null || target <= 0 ? 0 : Math.min(1, value / target);
  return (
    <div className="bs-panel grid min-w-0 justify-items-center rounded-[1.125rem] px-1 pt-2.5 pb-2 text-center" style={tint(color, 12)}>
      <Ring size={52} width={5} parts={[{ color, share }]} />
      <dd className="mt-1.5"><span className="bs-figure text-[1.0625rem]">{fmt(value)}</span><span className="bs-quiet text-xs"> g</span></dd>
      <dt className="text-xs font-semibold">{label}</dt>
      <dd className="bs-quiet text-xs">of {fmt(target)} g</dd>
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
