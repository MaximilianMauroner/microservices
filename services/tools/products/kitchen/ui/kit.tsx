import { Link, useHydrated, useRouter, useRouterState } from "@tanstack/react-router";
import { BookOpenIcon, CalendarDaysIcon, CheckIcon, ChevronDownIcon, LanguagesIcon, LayoutGridIcon, LeafIcon, RefrigeratorIcon, ShoppingBasketIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { AppShell } from "../../../platform/ui/components/app-shell.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../platform/ui/components/ui/dialog.js";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "../../../platform/ui/components/ui/drawer.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../../platform/ui/components/ui/dropdown-menu.js";
import { toast } from "../../../platform/ui/components/ui/toast.js";
import { useIsMobile } from "../../../platform/ui/components/ui/use-mobile.js";
import { cn } from "../../../platform/ui/lib/utils.js";
import type { KitchenAction } from "../actions.js";
import { addDays, byGroupOrder, type Kitchen, UNSORTED_SECTION } from "../domain.js";
import { runKitchenAction } from "../server-functions.js";
import { KITCHEN_LANGUAGES, type KitchenLanguage, LANGUAGE_NAMES, LOCALES, useLanguage, useSetLanguage, useText } from "./language.js";

export type Frame = Readonly<{ kitchen: Kitchen; kitchens: readonly Kitchen[]; isAdmin: boolean; today: string }>;

const TABS = [
  { key: "week", icon: CalendarDaysIcon, path: "" },
  { key: "shopping", icon: ShoppingBasketIcon, path: "/shopping" },
  { key: "recipes", icon: BookOpenIcon, path: "/recipes" },
  { key: "home", icon: RefrigeratorIcon, path: "/home" },
  { key: "ingredients", icon: LeafIcon, path: "/ingredients" }
] as const;

/** Loads the data of every tab into memory, so a tab switch needs no request. */
function preloadTabs(router: ReturnType<typeof useRouter>, kitchenId: string) {
  for (const tab of TABS) void router.preloadRoute({ to: `/kitchen/${kitchenId}${tab.path}` }).catch(() => undefined);
}

const en = {
  tabs: { week: ["Week", "Week"], shopping: ["Shopping list", "Shop"], recipes: ["Recipes", "Recipes"], home: ["At home", "At home"], ingredients: ["Ingredients", "Ingredients"] },
  pages: "Kitchen pages",
  manage: "Manage kitchens",
  allMine: "All my kitchens",
  noMembers: "No members yet",
  language: "Language",
  undo: "Undo",
  failed: "That did not work",
  tryAgain: "Try again.",
  fewer: (label: string) => `Fewer ${label.toLowerCase()}`,
  more: (label: string) => `More ${label.toLowerCase()}`,
  thisWeek: "This week",
  nextWeek: "Next week",
  lastWeek: "Last week",
  range: (from: string, to: string) => `${from} to ${to}`,
  pastUseBy: (day: string) => `Past use-by (${day})`,
  useToday: "Use today",
  useTomorrow: "Use by tomorrow",
  useBy: (day: string) => `Use by ${day}`,
  other: "Other",
  foodGroups: "Food groups"
};
type KitText = typeof en;
const TEXT: Record<KitchenLanguage, KitText> = {
  en,
  de: {
    tabs: { week: ["Woche", "Woche"], shopping: ["Einkaufsliste", "Einkauf"], recipes: ["Rezepte", "Rezepte"], home: ["Vorrat", "Vorrat"], ingredients: ["Zutaten", "Zutaten"] },
    pages: "Küchenseiten",
    manage: "Küchen verwalten",
    allMine: "Alle meine Küchen",
    noMembers: "Noch keine Mitglieder",
    language: "Sprache",
    undo: "Rückgängig",
    failed: "Das hat nicht funktioniert",
    tryAgain: "Versuch es noch einmal.",
    fewer: (label: string) => `Weniger ${label}`,
    more: (label: string) => `Mehr ${label}`,
    thisWeek: "Diese Woche",
    nextWeek: "Nächste Woche",
    lastWeek: "Letzte Woche",
    range: (from: string, to: string) => `${from} bis ${to}`,
    pastUseBy: (day: string) => `Abgelaufen (${day})`,
    useToday: "Heute verbrauchen",
    useTomorrow: "Bis morgen verbrauchen",
    useBy: (day: string) => `Verbrauchen bis ${day}`,
    other: "Sonstiges",
    foodGroups: "Lebensmittelgruppen"
  }
};

/**
 * The part of every kitchen page that stays on screen while you switch pages: the shell, the kitchen
 * switcher, and the page tabs. It loads the data of every tab when it opens, so a switch shows data that
 * is already in memory and refreshes it in the background.
 */
export function KitchenLayout({ frame, children }: { frame: Frame; children: ReactNode }) {
  const language = useLanguage();
  const text = TEXT[language];
  const pending = useRouterState({ select: (state) => state.status === "pending" });
  // The server render is always pending, so the line shows only after hydration.
  const loading = useHydrated() && pending;
  const router = useRouter();
  const base = `/kitchen/${frame.kitchen.id}`;
  useEffect(() => preloadTabs(router, frame.kitchen.id), [router, frame.kitchen.id]);
  return (
    <>
      <AppShell product="Kitchen" />
      <div aria-hidden className={cn("kitchen-progress fixed inset-x-0 top-0 z-50 h-0.5", loading && "kitchen-progress--on")} />
      <main id="main" lang={language} className="tools-page kitchen-page pb-28 md:pb-12">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <KitchenSwitcher frame={frame} />
          <div className="flex items-center gap-2">
            <nav aria-label={text.pages} className="hidden md:block">
              <ul className="flex gap-1 rounded-full bg-muted/60 p-1">
              {TABS.map((tab) => (
                <li key={tab.path}>
                  <Link
                    to={`${base}${tab.path}`}
                    activeOptions={{ exact: tab.path === "" }}
                    preload="intent"
                    title={text.tabs[tab.key][0]}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium lg:px-3 text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm"
                  >
                    <tab.icon className="size-4" aria-hidden />
                    {/* With the sidebar open, a tablet has no room for five labels. */}
                    <span className="sr-only lg:not-sr-only">{text.tabs[tab.key][0]}</span>
                  </Link>
                </li>
              ))}
              </ul>
            </nav>
            <LanguageMenu />
          </div>
        </div>
        {children}
      </main>
      <nav aria-label={text.pages} lang={language} className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid grid-cols-5">
          {TABS.map((tab) => (
            <li key={tab.path}>
              <Link
                to={`${base}${tab.path}`}
                activeOptions={{ exact: tab.path === "" }}
                preload="intent"
                className="group flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-muted-foreground aria-[current=page]:text-foreground"
              >
                <span className="grid h-7 w-12 place-items-center rounded-full transition-colors group-aria-[current=page]:bg-foreground group-aria-[current=page]:text-background">
                  <tab.icon className="size-[1.15rem]" aria-hidden />
                </span>
                {text.tabs[tab.key][1]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

/** The title row of one kitchen page. */
export function KitchenPage({ title, facts, actions, back, children }: { title: ReactNode; facts?: ReactNode; actions?: ReactNode; back?: ReactNode; children: ReactNode }) {
  return (
    <>
      {back ? <div className="-mt-2 mb-1">{back}</div> : null}
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-kitchen text-[2rem] leading-[1.05] font-normal sm:text-[2.5rem]">{title}</h1>
          {facts ? <p className="mt-1 text-sm text-muted-foreground">{facts}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </>
  );
}

/** Shown inside the kitchen layout only when a page takes longer than {@link KITCHEN_PAGE_ROUTE}'s pendingMs. */
function KitchenPagePending() {
  return (
    <div aria-busy="true" className="grid gap-3">
      <div className="h-10 w-48 rounded-lg bg-muted" />
      <div className="h-4 w-64 rounded bg-muted/70" />
      {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-20 rounded-xl bg-muted/50" />)}
    </div>
  );
}

/**
 * Route options for every page inside a kitchen. The old page stays until the new one is ready, and a
 * placeholder appears only after a slow wait. Page data stays fresh for 15 seconds, so a tab that was just
 * preloaded opens without a second request. Every change invalidates it at once.
 */
export const KITCHEN_PAGE_ROUTE = { pendingMs: 800, pendingMinMs: 300, pendingComponent: KitchenPagePending, staleTime: 15_000 } as const;

/** Switches the Kitchen pages between English and German. */
export function LanguageMenu() {
  const language = useLanguage();
  const setLanguage = useSetLanguage();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={TEXT[language].language} className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground md:h-9 md:px-2.5 outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <LanguagesIcon className="size-4" aria-hidden />
        {language.toUpperCase()}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {KITCHEN_LANGUAGES.map((option) => (
          <DropdownMenuItem key={option} lang={option} onClick={() => void setLanguage(option)}>
            <CheckIcon aria-hidden className={cn("size-4", option !== language && "invisible")} />
            {LANGUAGE_NAMES[option]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function KitchenSwitcher({ frame }: { frame: Frame }) {
  const text = useText(TEXT);
  const language = useLanguage();
  const others = frame.kitchens.filter((kitchen) => kitchen.id !== frame.kitchen.id);
  const label = (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted font-kitchen text-base text-foreground" aria-hidden>
        {frame.kitchen.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 text-left">
        <span className="block truncate text-sm font-semibold">{frame.kitchen.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{memberLine(frame.kitchen, language)}</span>
      </span>
    </span>
  );
  if (!others.length && !frame.isAdmin) return label;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="-mx-2 flex min-w-0 items-center gap-2 rounded-xl px-2 py-1 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50">
        {label}
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60">
        {others.map((kitchen) => (
          <DropdownMenuItem key={kitchen.id} render={<Link to="/kitchen/$kitchenId" params={{ kitchenId: kitchen.id }} />}>
            <span className="min-w-0">
              <span className="block truncate">{kitchen.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{memberLine(kitchen, language)}</span>
            </span>
          </DropdownMenuItem>
        ))}
        {others.length ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem render={<Link to="/kitchen" search={{ all: true }} />}>
          <LayoutGridIcon aria-hidden />
          {frame.isAdmin ? text.manage : text.allMine}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function memberLine(kitchen: Kitchen, language: KitchenLanguage): string {
  if (!kitchen.members.length) return TEXT[language].noMembers;
  return kitchen.members.map((member) => member.email.split("@")[0]).join(", ");
}

/** Runs one kitchen change, reloads the page data, and reports a failure in a toast. */
/** The signed-in person, the language, and the kitchen frame do not change with a kitchen action. */
const UNCHANGED_BY_ACTIONS = new Set<string>(["__root__", "/kitchen", "/kitchen/$kitchenId"]);

export function useKitchenAction(kitchenId: string) {
  const router = useRouter();
  const text = useText(TEXT);
  const [pending, setPending] = useState(false);
  async function run(action: KitchenAction, done?: { title: string; undo?: KitchenAction }): Promise<{ id?: string } | undefined> {
    setPending(true);
    try {
      const result = await runKitchenAction({ data: { kitchenId, action } });
      await router.invalidate({ filter: (match) => !UNCHANGED_BY_ACTIONS.has(match.routeId) });
      // A change on one tab changes the others too, for example a new meal changes the shopping list.
      preloadTabs(router, kitchenId);
      if (done) {
        const undo = done.undo;
        toast.add({
          title: done.title,
          type: "success",
          actionProps: undo ? { children: text.undo, onClick: () => void run(undo) } : undefined
        });
      }
      return result;
    } catch (error) {
      toast.add({ title: text.failed, description: messageOf(error) ?? text.tryAgain, type: "error" });
      return undefined;
    } finally {
      setPending(false);
    }
  }
  return { run, pending };
}

/** The server's message for a failed change, or undefined when it has none. */
export function messageOf(error: unknown): string | undefined {
  if (error instanceof Error && error.message) {
    try {
      const parsed = JSON.parse(error.message) as unknown;
      if (Array.isArray(parsed) && parsed[0] && typeof parsed[0].message === "string") return parsed[0].message;
    } catch { /* plain message */ }
    return error.message;
  }
  return undefined;
}

/** A form surface: a bottom sheet on phones, where thumbs reach it, and a dialog on larger screens. */
export function KitchenSheet({ open, onOpenChange, title, description, children, footer }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
        <DrawerContent className="max-h-[92dvh]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-kitchen text-xl font-normal">{title}</DrawerTitle>
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
          <DialogTitle className="font-kitchen text-xl font-normal">{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="-mx-1 min-h-0 overflow-y-auto px-1">{children}</div>
        {footer ? <DialogFooter>{footer}</DialogFooter> : <span />}
      </DialogContent>
    </Dialog>
  );
}

/** A number control with large minus and plus targets, for servings at the stove. */
export function Stepper({ value, onValue, min = 1, max = 100, label }: { value: number; onValue: (value: number) => void; min?: number; max?: number; label: string }) {
  const text = useText(TEXT);
  return (
    <div className="inline-flex items-center rounded-full border border-control-border bg-control" role="group" aria-label={label}>
      <button type="button" className="grid size-11 place-items-center rounded-full text-lg hover:bg-control-hover disabled:opacity-40 md:size-10" onClick={() => onValue(Math.max(min, value - 1))} disabled={value <= min} aria-label={text.fewer(label)}>−</button>
      <output className="w-9 text-center text-sm font-semibold tabular-nums" aria-live="polite">{value}</output>
      <button type="button" className="grid size-11 place-items-center rounded-full text-lg hover:bg-control-hover disabled:opacity-40 md:size-10" onClick={() => onValue(Math.min(max, value + 1))} disabled={value >= max} aria-label={text.more(label)}>+</button>
    </div>
  );
}

const DATE_FORMATS = Object.fromEntries(KITCHEN_LANGUAGES.map((language) => [language, {
  weekday: new Intl.DateTimeFormat(LOCALES[language], { weekday: "short", timeZone: "UTC" }),
  weekdayLong: new Intl.DateTimeFormat(LOCALES[language], { weekday: "long", timeZone: "UTC" }),
  dayMonth: new Intl.DateTimeFormat(LOCALES[language], { day: "numeric", month: "short", timeZone: "UTC" })
}])) as Record<KitchenLanguage, Record<"weekday" | "weekdayLong" | "dayMonth", Intl.DateTimeFormat>>;

export function dayParts(day: string, language: KitchenLanguage) {
  const date = new Date(`${day}T00:00:00Z`);
  const format = DATE_FORMATS[language];
  return { weekday: format.weekday.format(date), weekdayLong: format.weekdayLong.format(date), number: date.getUTCDate(), dayMonth: format.dayMonth.format(date) };
}

export function weekLabel(start: string, today: string, language: KitchenLanguage): string {
  const text = TEXT[language];
  const thisWeek = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  if (start === thisWeek) return text.thisWeek;
  if (start === addDays(thisWeek, 7)) return text.nextWeek;
  if (start === addDays(thisWeek, -7)) return text.lastWeek;
  return text.range(dayParts(start, language).dayMonth, dayParts(addDays(start, 6), language).dayMonth);
}

export function useByLabel(useBy: string, today: string, language: KitchenLanguage): { text: string; urgent: boolean } {
  const text = TEXT[language];
  const parts = dayParts(useBy, language);
  const days = Math.round((Date.parse(`${useBy}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return { text: text.pastUseBy(parts.dayMonth), urgent: true };
  if (days === 0) return { text: text.useToday, urgent: true };
  if (days === 1) return { text: text.useTomorrow, urgent: true };
  return { text: text.useBy(`${parts.weekday} ${parts.dayMonth}`), urgent: false };
}

/** The name to show for a group. Kitchens name their own groups, so only the fallback group is translated. */
export function groupLabel(group: string, language: KitchenLanguage): string {
  return group === UNSORTED_SECTION ? TEXT[language].other : group;
}

export function Pill({ children, tone = "muted", className }: { children: ReactNode; tone?: "muted" | "accent" | "warn"; className?: string }) {
  return (
    <span className={cn(
      "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium",
      tone === "accent" && "bg-foreground text-background",
      tone === "warn" && "bg-destructive/10 text-destructive",
      tone === "muted" && "bg-muted text-muted-foreground",
      className
    )}>{children}</span>
  );
}

/** The color of an ingredient group. Its place in the kitchen's group order picks one of eight hues. */
export function groupColor(groups: readonly string[], group: string): string {
  if (group === UNSORTED_SECTION) return "var(--muted-foreground)";
  let index = groups.indexOf(group);
  if (index === -1) index = [...group].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  return `var(--kitchen-group-${index % 8})`;
}

export function GroupDot({ groups, group, className }: { groups: readonly string[]; group: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ background: groupColor(groups, group) }} />;
}

/** Items in the kitchen's group order, keyed by group. */
export function byGroup<T>(groups: readonly string[], items: readonly T[], groupOf: (item: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(groupOf(item), [...(map.get(groupOf(item)) ?? []), item]);
  const order = byGroupOrder(groups);
  return [...map].sort(([a], [b]) => order(a, b));
}

/** A thin bar of the food groups in a dish, a week, or a list. Each group gets a segment as wide as its share. */
export function BalanceStripe({ groups, sections, vertical = false, className }: { groups: readonly string[]; sections: readonly string[]; vertical?: boolean; className?: string }) {
  const language = useLanguage();
  const counts = byGroup(groups, sections, (section) => section);
  if (!counts.length) return <span aria-hidden className={cn("block rounded-full border border-dashed border-[color:var(--surface-border)]", vertical ? "w-1.5" : "h-1.5", className)} />;
  return (
    <span role="img" aria-label={`${TEXT[language].foodGroups}: ${counts.map(([group, items]) => `${groupLabel(group, language)} ${items.length}`).join(", ")}`} className={cn("flex gap-0.5 overflow-hidden rounded-full", vertical ? "w-1.5 flex-col" : "h-1.5", className)}>
      {counts.map(([group, items]) => <span key={group} className={vertical ? "min-h-1.5" : "min-w-1.5"} style={{ flexGrow: items.length, background: groupColor(groups, group) }} />)}
    </span>
  );
}

