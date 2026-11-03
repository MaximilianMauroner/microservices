import { Link, useNavigate } from "@tanstack/react-router";
import { CheckIcon, ChefHatIcon, ChevronLeftIcon, ChevronRightIcon, PencilIcon, PlusIcon, RotateCcwIcon, ShoppingBasketIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../../platform/ui/components/ui/button.js";
import { Label } from "../../../platform/ui/components/ui/label.js";
import { cn } from "../../../platform/ui/lib/utils.js";
import { addDays, formatAmount, type Ingredient, type Leftover, type Meal, MEALS, type PlanEntry, weekDays } from "../domain.js";
import type { RecipeSummary } from "../server-functions.js";
import { dayParts, type Frame, groupColor, KitchenPage, KitchenSheet, mainGroup, Pill, PlateRing, SearchField, Stepper, tint, useByLabel, useKitchenAction, weekLabel, weekRange } from "./kit.js";
import { type KitchenLanguage, useLanguage, useText } from "./language.js";
import { type DraftLine, draftLines, LineEditor, useResolveLines } from "./lines.js";

const en = {
  previousWeek: "Previous week",
  nextWeek: "Next week",
  today: "Today",
  daysOfWeek: "Days of the week",
  plannedFacts: (planned: number, cooked: number) => `${planned} ${planned === 1 ? "meal" : "meals"} planned, ${cooked} cooked`,
  nothingPlanned: "Nothing planned yet. Pick a day to start.",
  planAnother: (weekday: string, date: string) => `Plan another meal on ${weekday} ${date}`,
  planMeal: (weekday: string, date: string) => `Plan a meal on ${weekday} ${date}`,
  servings: (count: number) => `${count} ${count === 1 ? "serving" : "servings"}`,
  kcalEach: (kcal: number) => `, ${kcal} kcal each`,
  meals: { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" },
  cooked: "Cooked",
  nothingPlannedDay: "Nothing planned",
  add: "Add",
  planAMeal: "Plan a meal",
  glance: "This week at a glance",
  toBuy: (count: number) => (count === 1 ? "1 thing to buy" : `${count} things to buy`),
  nothingToBuy: "Nothing to buy",
  notCookedYet: "for the meals not cooked yet",
  useFirst: "Use first",
  noLeftovers: "No leftovers. When you cook more than you eat, keep the rest here.",
  openAtHome: "Open At home",
  planTitle: (weekday: string, date: string) => `Plan ${weekday}, ${date}`,
  addToPlan: "Add to plan",
  findRecipe: "Find a recipe",
  meal: "Meal",
  servingsLabel: "Servings",
  recipes: "Recipes",
  idea: "Idea",
  noRecipeMatch: (query: string) => `No recipe matches “${query}”.`,
  plansUseRecipes: "Plans use your recipes. Add a recipe first, even if it is only a name.",
  addARecipe: "Add a recipe",
  mealFallback: "Meal",
  planned: (name: string, weekday: string) => `${name} planned for ${weekday}`,
  removedFromPlan: (name: string) => `${name} removed from the plan`,
  remove: "Remove",
  planChanged: "Plan changed",
  saveChanges: "Save changes",
  markCooked: "Mark cooked",
  cookedLeftover: (count: number) => `Cooked. ${count} ${count === 1 ? "serving" : "servings"} kept for later.`,
  cookedTaken: "Cooked. Ingredients taken from At home.",
  cookedSuffix: ". Cooked.",
  day: "Day",
  leftoverLabel: "Servings left over",
  leftoverNote: "Kept in At home for 3 days when you mark it cooked",
  leftoverAria: "Leftover servings",
  cookedMeal: "This meal is cooked. Its ingredients came out of At home.",
  openRecipe: "Open the recipe",
  ingredientsLabel: "Ingredients",
  onlyThisMeal: "Only this meal",
  noIngredients: "No ingredients for this meal.",
  changeThisMeal: "Change for this meal",
  saveFirst: "Save the other changes first.",
  useRecipeAgain: "Use the recipe again",
  editHint: "Changes apply to this meal only. The recipe stays as it is.",
  cancel: "Cancel",
  saveForMeal: "Save for this meal",
  changedForMeal: "Changed for this meal",
  backToRecipe: "This meal uses the recipe again"
};

const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: {
    previousWeek: "Vorherige Woche",
    nextWeek: "Nächste Woche",
    today: "Heute",
    daysOfWeek: "Tage der Woche",
    plannedFacts: (planned: number, cooked: number) => `${planned === 1 ? "1 Mahlzeit" : `${planned} Mahlzeiten`} geplant, ${cooked} gekocht`,
    nothingPlanned: "Noch nichts geplant. Wähle einen Tag, um anzufangen.",
    planAnother: (weekday: string, date: string) => `Noch eine Mahlzeit am ${weekday}, ${date} planen`,
    planMeal: (weekday: string, date: string) => `Mahlzeit am ${weekday}, ${date} planen`,
    servings: (count: number) => (count === 1 ? "1 Portion" : `${count} Portionen`),
    kcalEach: (kcal: number) => `, ${kcal} kcal pro Portion`,
    meals: { breakfast: "Frühstück", lunch: "Mittagessen", dinner: "Abendessen", snack: "Snack" },
    cooked: "Gekocht",
    nothingPlannedDay: "Nichts geplant",
    add: "Hinzufügen",
    planAMeal: "Mahlzeit planen",
    glance: "Diese Woche auf einen Blick",
    toBuy: (count: number) => `${count} Artikel zu kaufen`,
    nothingToBuy: "Nichts zu kaufen",
    notCookedYet: "für die Mahlzeiten, die noch nicht gekocht sind",
    useFirst: "Zuerst verbrauchen",
    noLeftovers: "Keine Reste. Wenn du mehr kochst, als du isst, bewahre den Rest hier auf.",
    openAtHome: "Vorrat öffnen",
    planTitle: (weekday: string, date: string) => `${weekday}, ${date} planen`,
    addToPlan: "Zum Plan hinzufügen",
    findRecipe: "Rezept suchen",
    meal: "Mahlzeit",
    servingsLabel: "Portionen",
    recipes: "Rezepte",
    idea: "Idee",
    noRecipeMatch: (query: string) => `Kein Rezept passt zu „${query}“.`,
    plansUseRecipes: "Pläne nutzen deine Rezepte. Füge zuerst ein Rezept hinzu, auch wenn es nur ein Name ist.",
    addARecipe: "Rezept hinzufügen",
    mealFallback: "Mahlzeit",
    planned: (name: string, weekday: string) => `${name} für ${weekday} geplant`,
    removedFromPlan: (name: string) => `${name} aus dem Plan entfernt`,
    remove: "Entfernen",
    planChanged: "Plan geändert",
    saveChanges: "Änderungen speichern",
    markCooked: "Als gekocht markieren",
    cookedLeftover: (count: number) => `Gekocht. ${count === 1 ? "1 Portion" : `${count} Portionen`} für später aufgehoben.`,
    cookedTaken: "Gekocht. Die Zutaten sind aus dem Vorrat abgebucht.",
    cookedSuffix: ". Gekocht.",
    day: "Tag",
    leftoverLabel: "Portionen übrig",
    leftoverNote: "Bleiben 3 Tage im Vorrat, wenn du die Mahlzeit als gekocht markierst",
    leftoverAria: "Restportionen",
    cookedMeal: "Diese Mahlzeit ist gekocht. Die Zutaten kamen aus dem Vorrat.",
    openRecipe: "Rezept öffnen",
    ingredientsLabel: "Zutaten",
    onlyThisMeal: "Nur diese Mahlzeit",
    noIngredients: "Keine Zutaten für diese Mahlzeit.",
    changeThisMeal: "Für diese Mahlzeit ändern",
    saveFirst: "Speichere zuerst die anderen Änderungen.",
    useRecipeAgain: "Wieder das Rezept nutzen",
    editHint: "Die Änderungen gelten nur für diese Mahlzeit. Das Rezept bleibt, wie es ist.",
    cancel: "Abbrechen",
    saveForMeal: "Für diese Mahlzeit speichern",
    changedForMeal: "Für diese Mahlzeit geändert",
    backToRecipe: "Diese Mahlzeit nutzt wieder das Rezept"
  }
};

type WeekData = Frame & { week: { start: string; entries: readonly PlanEntry[] }; recipes: readonly RecipeSummary[]; ingredients: readonly Ingredient[]; leftovers: readonly Leftover[]; toBuy: number; buySections: readonly string[] };

export function KitchenWeekPage(data: WeekData) {
  const { kitchen, week, today } = data;
  const navigate = useNavigate();
  const language = useLanguage();
  const text = useText(TEXT);
  const [planning, setPlanning] = useState<string | undefined>();
  const [openId, setOpenId] = useState<string | undefined>();
  const days = weekDays(week.start);
  const byDay = useMemo(() => groupBy(week.entries), [week.entries]);
  const recipes = new Map(data.recipes.map((recipe) => [recipe.id, recipe]));
  const planned = week.entries.length;
  const cooked = week.entries.filter((entry) => entry.cooked).length;
  const goWeek = (start: string) => void navigate({ to: "/kitchen/$kitchenId", params: { kitchenId: kitchen.id }, search: { week: start } });
  const title = weekLabel(week.start, today, language);
  const range = weekRange(week.start, language);

  return (
    <KitchenPage
      title={title}
      facts={`${title === range ? "" : `${range}. `}${planned ? text.plannedFacts(planned, cooked) : text.nothingPlanned}`}
      actions={(
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="size-11 md:size-9" aria-label={text.previousWeek} onClick={() => goWeek(addDays(week.start, -7))}><ChevronLeftIcon /></Button>
          <Button variant="outline" onClick={() => goWeek(today)} disabled={days.includes(today)}>{text.today}</Button>
          <Button variant="outline" size="icon" className="size-11 md:size-9" aria-label={text.nextWeek} onClick={() => goWeek(addDays(week.start, 7))}><ChevronRightIcon /></Button>
        </div>
      )}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <ol className="divide-y divide-[color:var(--surface-border)] border-y border-[color:var(--surface-border)]" aria-label={text.daysOfWeek}>
          {days.map((day) => {
            const parts = dayParts(day, language);
            const isToday = day === today;
            const past = day < today;
            const entries = byDay.get(day) ?? [];
            return (
              <li key={day} className={cn("grid grid-cols-[3.25rem_minmax(0,1fr)] gap-3 py-3 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-4", isToday && "-mx-2 rounded-2xl bg-[color-mix(in_srgb,var(--kitchen-hue)_7%,transparent)] px-2")} aria-current={isToday ? "date" : undefined}>
                <div className={cn("flex flex-col items-center gap-1 pt-1", past && "text-muted-foreground")}>
                  <span className={cn("text-xs font-medium", isToday ? "font-semibold text-(--kitchen-hue-ink)" : "text-muted-foreground")}>{isToday ? text.today : parts.weekday}</span>
                  <span className={cn(
                    "grid size-11 place-items-center rounded-full font-kitchen font-medium tracking-tight text-[1.625rem] leading-none tabular-nums sm:size-12 sm:text-[1.875rem]",
                    isToday && "bg-primary text-primary-foreground shadow-sm"
                  )}>{parts.number}</span>
                  {entries.length ? (
                    <button
                      type="button"
                      onClick={() => setPlanning(day)}
                      className="mt-1 grid size-11 place-items-center rounded-full border border-dashed border-[color:var(--surface-border)] text-muted-foreground hover:border-primary hover:text-(--kitchen-hue-ink) focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:hidden"
                      aria-label={text.planAnother(parts.weekdayLong, parts.dayMonth)}
                    >
                      <PlusIcon className="size-4" aria-hidden />
                    </button>
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch">
                  {entries.map((entry) => {
                    const recipe = recipes.get(entry.recipeId);
                    const group = mainGroup(kitchen.groups, recipe?.sections ?? []);
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setOpenId(entry.id)}
                        style={entry.cooked || !group ? undefined : { background: tint(groupColor(kitchen.groups, group), 16) }}
                        className={cn(
                          "flex min-h-16 w-full items-start gap-3 rounded-xl bg-muted/60 py-2.5 pr-3 pl-2.5 text-left transition-[filter,background-color] hover:brightness-[1.06] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:w-auto sm:min-w-60 sm:flex-1",
                          entry.cooked && "bg-transparent ring-1 ring-[color:var(--surface-border)] ring-inset hover:bg-muted/40"
                        )}
                      >
                        <PlateRing groups={kitchen.groups} sections={recipe?.sections ?? []} size={34} className={cn("mt-0.5", entry.cooked && "opacity-40")} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            {text.meals[entry.meal]}
                            {entry.cooked ? <span className="inline-flex items-center gap-1 font-medium text-foreground"><CheckIcon className="size-3.5" aria-hidden />{text.cooked}</span> : null}
                          </span>
                          <span className={cn("mt-0.5 block font-kitchen font-medium text-[1.0625rem] leading-snug break-words", entry.cooked && "text-muted-foreground")}>{entry.recipe}</span>
                          <span className="mt-1 block text-xs text-muted-foreground tabular-nums">
                            {text.servings(entry.servings)}{recipe?.kcal ? text.kcalEach(recipe.kcal) : ""}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  {past && !entries.length ? <span className="flex min-h-16 items-center text-sm text-muted-foreground">{text.nothingPlannedDay}</span> : (
                    <button
                      type="button"
                      onClick={() => setPlanning(day)}
                      className={cn("flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-dashed border-[color:var(--surface-border)] px-4 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-(--kitchen-hue-ink) focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-16", entries.length ? "hidden sm:flex sm:min-h-0 sm:h-11 sm:self-center sm:rounded-full sm:px-3.5" : "sm:flex-1 sm:justify-start")}
                      aria-label={text.planMeal(parts.weekdayLong, parts.dayMonth)}
                    >
                      <PlusIcon className="size-4" aria-hidden /> {entries.length ? text.add : text.planAMeal}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <aside className="grid content-start gap-3 sm:grid-cols-2 xl:grid-cols-1" aria-label={text.glance}>
          <Link
            to="/kitchen/$kitchenId/shopping"
            params={{ kitchenId: kitchen.id }}
            search={{ week: week.start }}
            className="flex items-center gap-4 rounded-2xl p-4 transition-[filter] hover:brightness-[1.04] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            style={{ background: tint("var(--kitchen-shopping-ink)", 10) }}
          >
            {data.buySections.length
              ? <PlateRing groups={kitchen.groups} sections={data.buySections} size={60} />
              : <span className="grid size-[3.75rem] shrink-0 place-items-center rounded-full text-(--kitchen-shopping-ink)" style={{ background: "color-mix(in srgb, var(--kitchen-shopping-ink) 16%, transparent)" }}><ShoppingBasketIcon className="size-6" aria-hidden /></span>}
            <span>
              <span className="block font-kitchen font-semibold tracking-tight text-lg leading-tight text-(--kitchen-shopping-ink)">{data.toBuy ? text.toBuy(data.toBuy) : text.nothingToBuy}</span>
              <span className="block text-xs text-muted-foreground">{text.notCookedYet}</span>
            </span>
          </Link>
          <section className="rounded-2xl p-4" style={{ background: data.leftovers.some((one) => useByLabel(one.useBy, today, language).urgent) ? tint("var(--destructive)", 7) : "var(--muted)" }}>
            <h2 className="font-kitchen font-semibold tracking-tight text-lg leading-tight">{text.useFirst}</h2>
            {data.leftovers.length ? (
              <ul className="mt-2 grid gap-2">
                {data.leftovers.slice(0, 5).map((leftover) => {
                  const label = useByLabel(leftover.useBy, today, language);
                  return (
                    <li key={leftover.id} className="text-sm">
                      <span className="block font-medium">{leftover.name}</span>
                      <span className={cn("text-xs", label.urgent ? "text-destructive" : "text-muted-foreground")}>{text.servings(leftover.servings)}. {label.text}</span>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="mt-1 text-xs text-muted-foreground">{text.noLeftovers}</p>}
            <Link to="/kitchen/$kitchenId/home" params={{ kitchenId: kitchen.id }} className="mt-1 inline-flex min-h-11 items-center text-sm font-medium underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">{text.openAtHome}</Link>
          </section>
        </aside>
      </div>
      <PlanSheet day={planning} onClose={() => setPlanning(undefined)} data={data} />
      <EntrySheet entry={week.entries.find((entry) => entry.id === openId)} onClose={() => setOpenId(undefined)} data={data} />
    </KitchenPage>
  );
}

function groupBy(entries: readonly PlanEntry[]) {
  const map = new Map<string, PlanEntry[]>();
  for (const entry of entries) map.set(entry.day, [...(map.get(entry.day) ?? []), entry]);
  return map;
}

function defaultMeal(entries: readonly PlanEntry[] | undefined): Meal {
  const taken = new Set(entries?.map((entry) => entry.meal));
  return (["dinner", "lunch", "breakfast", "snack"] as const).find((meal) => !taken.has(meal)) ?? "dinner";
}

function PlanSheet({ day, onClose, data }: { day: string | undefined; onClose: () => void; data: WeekData }) {
  const { run, pending } = useKitchenAction(data.kitchen.id);
  const language = useLanguage();
  const text = useText(TEXT);
  const [meal, setMeal] = useState<Meal>("dinner");
  const [query, setQuery] = useState("");
  const [recipeId, setRecipeId] = useState<string | undefined>();
  const [servings, setServings] = useState(2);
  const [lastDay, setLastDay] = useState<string | undefined>();
  if (day !== lastDay) {
    setLastDay(day);
    if (day) {
      setMeal(defaultMeal(data.week.entries.filter((entry) => entry.day === day)));
      setQuery("");
      setRecipeId(undefined);
    }
  }
  const matches = data.recipes.filter((recipe) => recipe.name.toLowerCase().includes(query.trim().toLowerCase()));
  const parts = day ? dayParts(day, language) : undefined;

  async function plan() {
    if (!day || !recipeId) return;
    const recipe = data.recipes.find((one) => one.id === recipeId);
    const done = await run({ type: "plan.add", day, meal, recipeId, servings }, { title: text.planned(recipe?.name ?? text.mealFallback, parts!.weekdayLong) });
    if (done) onClose();
  }

  return (
    <KitchenSheet
      open={day !== undefined}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={parts ? text.planTitle(parts.weekdayLong, parts.dayMonth) : text.planAMeal}
      footer={data.recipes.length ? (
        <div className="grid w-full gap-3">
          <div className="grid grid-cols-4 gap-1 rounded-full bg-muted/60 p-1" role="radiogroup" aria-label={text.meal}>
            {MEALS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={meal === option}
                onClick={() => setMeal(option)}
                className="h-9 rounded-full text-sm font-medium text-muted-foreground aria-checked:bg-primary aria-checked:text-primary-foreground aria-checked:shadow-sm"
              >
                {text.meals[option]}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <Stepper label={text.servingsLabel} value={servings} onValue={setServings} />
            <Button size="lg" className="px-5" onClick={plan} disabled={!recipeId || pending}>{text.addToPlan}</Button>
          </div>
        </div>
      ) : undefined}
    >
      {data.recipes.length ? (
        <SearchField value={query} onValue={setQuery} label={text.findRecipe} inSheet>
          <ul className="grid gap-1" role="listbox" aria-label={text.recipes}>
            {matches.map((recipe) => (
              <li key={recipe.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={recipeId === recipe.id}
                  onClick={() => { setRecipeId(recipe.id); setServings(recipe.servings); }}
                  className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left hover:bg-muted/60 aria-selected:border-primary aria-selected:bg-[color-mix(in_srgb,var(--kitchen-hue)_12%,transparent)]"
                >
                  <PlateRing groups={data.kitchen.groups} sections={recipe.sections} size={26} />
                  <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                    <span className="min-w-0 font-kitchen font-medium text-base leading-snug break-words">{recipe.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {recipe.ingredientCount ? [recipe.minutes ? `${recipe.minutes} min` : "", recipe.kcal ? `${recipe.kcal} kcal` : ""].filter(Boolean).join(", ") : text.idea}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {!matches.length ? <li className="px-3 py-6 text-center text-sm text-muted-foreground">{text.noRecipeMatch(query)}</li> : null}
          </ul>
        </SearchField>
      ) : (
        <div className="grid justify-items-start gap-3 pb-2">
          <p className="text-sm text-muted-foreground">{text.plansUseRecipes}</p>
          <Button nativeButton={false} render={<Link to="/kitchen/$kitchenId/recipes" params={{ kitchenId: data.kitchen.id }} />}>{text.addARecipe}</Button>
        </div>
      )}
    </KitchenSheet>
  );
}

function EntrySheet({ entry, onClose, data }: { entry: PlanEntry | undefined; onClose: () => void; data: WeekData }) {
  const { run, pending } = useKitchenAction(data.kitchen.id);
  const language = useLanguage();
  const text = useText(TEXT);
  const [servings, setServings] = useState(1);
  const [day, setDay] = useState("");
  const [meal, setMeal] = useState<Meal>("dinner");
  const [leftover, setLeftover] = useState(0);
  const [draft, setDraft] = useState<DraftLine[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const resolveLines = useResolveLines(data.kitchen.id, data.ingredients);
  const [lastId, setLastId] = useState<string | undefined>();
  if (entry?.id !== lastId) {
    setLastId(entry?.id);
    if (entry) { setServings(entry.servings); setDay(entry.day); setMeal(entry.meal); setLeftover(0); setDraft(undefined); setError(undefined); }
  }
  if (!entry) return <KitchenSheet open={false} onOpenChange={() => {}} title="">{null}</KitchenSheet>;
  const changed = servings !== entry.servings || day !== entry.day || meal !== entry.meal;
  const days = weekDays(data.week.start);
  const current = entry.lines.map((line) => ({ ingredientId: line.ingredientId, amount: line.amount, note: line.note }));

  async function saveLines() {
    if (!draft || !entry) return;
    setError(undefined);
    const lines = await resolveLines(draft);
    if (typeof lines === "string") return setError(lines);
    if (!lines) return;
    const undo = entry.custom ? { type: "plan.customize" as const, id: entry.id, lines: current } : { type: "plan.reset" as const, id: entry.id };
    if (await run({ type: "plan.customize", id: entry.id, lines }, { title: text.changedForMeal, undo })) setDraft(undefined);
  }

  return (
    <KitchenSheet
      open
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={entry.recipe}
      description={`${text.meals[entry.meal]}, ${dayParts(entry.day, language).weekdayLong} ${dayParts(entry.day, language).dayMonth}${entry.cooked ? text.cookedSuffix : ""}`}
      footer={draft ? (
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="ghost" disabled={pending} onClick={() => { setDraft(undefined); setError(undefined); }}>{text.cancel}</Button>
          <Button size="lg" className="px-4" disabled={pending} onClick={saveLines}>{text.saveForMeal}</Button>
        </div>
      ) : (
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="destructive-subtle" disabled={pending} onClick={async () => {
            if (await run({ type: "plan.remove", id: entry.id }, { title: text.removedFromPlan(entry.recipe), undo: { type: "plan.add", day: entry.day, meal: entry.meal, recipeId: entry.recipeId, servings: entry.servings } })) onClose();
          }}>{text.remove}</Button>
          <div className="flex gap-2">
            {changed ? <Button variant="outline" disabled={pending} onClick={async () => { if (await run({ type: "plan.update", id: entry.id, day, meal, servings }, { title: text.planChanged })) onClose(); }}>{text.saveChanges}</Button> : null}
            {!entry.cooked ? (
              <Button size="lg" className="px-4" disabled={pending || changed} onClick={async () => {
                const useBy = addDays(data.today, 3);
                if (await run({ type: "plan.cook", id: entry.id, leftover: leftover ? { servings: leftover, useBy } : undefined }, { title: leftover ? text.cookedLeftover(leftover) : text.cookedTaken })) onClose();
              }}><ChefHatIcon aria-hidden /> {text.markCooked}</Button>
            ) : null}
          </div>
        </div>
      )}
    >
      {draft ? (
        <div className="grid gap-3 pb-1">
          <p className="text-sm text-muted-foreground">{text.editHint}</p>
          <LineEditor lines={draft} onLines={(update) => setDraft((lines) => update(lines ?? []))} ingredients={data.ingredients} />
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
      ) : (
      <div className="grid gap-5 pb-1">
        {!entry.cooked ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Label>{text.servingsLabel}</Label>
              <Stepper label={text.servingsLabel} value={servings} onValue={setServings} />
            </div>
            <div className="grid gap-2">
              <Label>{text.day}</Label>
              <div className="grid grid-cols-7 gap-1">
                {days.map((option) => (
                  <button key={option} type="button" aria-pressed={day === option} onClick={() => setDay(option)}
                    className="flex h-12 flex-col items-center justify-center rounded-xl text-xs text-muted-foreground hover:bg-muted/60 aria-pressed:bg-primary aria-pressed:text-primary-foreground">
                    <span>{dayParts(option, language).weekday}</span><span className="text-sm font-semibold tabular-nums">{dayParts(option, language).number}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1 rounded-full bg-muted/60 p-1" role="radiogroup" aria-label={text.meal}>
              {MEALS.map((option) => (
                <button key={option} type="button" role="radio" aria-checked={meal === option} onClick={() => setMeal(option)}
                  className="h-9 rounded-full text-sm font-medium text-muted-foreground aria-checked:bg-primary aria-checked:text-primary-foreground aria-checked:shadow-sm">
                  {text.meals[option]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/50 p-3">
              <span className="text-sm">
                <span className="block font-medium">{text.leftoverLabel}</span>
                <span className="block text-xs text-muted-foreground">{text.leftoverNote}</span>
              </span>
              <Stepper label={text.leftoverAria} value={leftover} onValue={setLeftover} min={0} max={servings} />
            </div>
          </>
        ) : <p className="text-sm text-muted-foreground">{text.cookedMeal}</p>}
        <section className="grid gap-2" aria-label={text.ingredientsLabel}>
          <div className="flex items-center justify-between gap-2">
            <Label>{text.ingredientsLabel}</Label>
            {entry.custom ? <Pill tone="accent">{text.onlyThisMeal}</Pill> : null}
          </div>
          {entry.lines.length ? (
            <ul className="grid gap-1.5 text-sm">
              {entry.lines.map((line) => (
                <li key={line.ingredientId} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words">{line.ingredient}{line.note ? <span className="text-muted-foreground">, {line.note}</span> : null}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">{formatAmount(line.amount, line.unit, language)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">{text.noIngredients}</p>}
          {!entry.cooked ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={pending || changed} title={changed ? text.saveFirst : undefined} onClick={() => setDraft(draftLines(entry.lines))}><PencilIcon aria-hidden /> {text.changeThisMeal}</Button>
              {entry.custom ? (
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => void run({ type: "plan.reset", id: entry.id }, { title: text.backToRecipe, undo: { type: "plan.customize", id: entry.id, lines: current } })}>
                  <RotateCcwIcon aria-hidden /> {text.useRecipeAgain}
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
        <Link to="/kitchen/$kitchenId/recipes/$recipeId" params={{ kitchenId: data.kitchen.id, recipeId: entry.recipeId }} className="text-sm font-medium underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">{text.openRecipe}</Link>
      </div>
      )}
    </KitchenSheet>
  );
}
