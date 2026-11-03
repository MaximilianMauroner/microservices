import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, ClockIcon, CopyIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../platform/ui/components/ui/button.js";
import { Input } from "../../../platform/ui/components/ui/input.js";
import { Label } from "../../../platform/ui/components/ui/label.js";
import { Textarea } from "../../../platform/ui/components/ui/textarea.js";
import { cn } from "../../../platform/ui/lib/utils.js";
import { formatAmount, type Ingredient, type Nutrition, type Recipe, scaledLines } from "../domain.js";
import type { RecipeSummary } from "../server-functions.js";
import { byGroup, type Frame, GroupDot, groupColor, KitchenEmpty, KitchenPage, KitchenSheet, mainGroup, PlateRing, SearchField, Stepper, tint, useKitchenAction } from "./kit.js";
import { type KitchenLanguage, useLanguage, useText } from "./language.js";
import { type DraftLine, draftLines, LineEditor, useResolveLines } from "./lines.js";

const en = {
  title: "Recipes",
  recipes: (count: number) => count === 1 ? "1 recipe" : `${count} recipes`,
  stillIdeas: (count: number) => count === 1 ? ", 1 still an idea without ingredients" : `, ${count} still ideas without ingredients`,
  intro: "Collect the dishes you cook. A name is enough to start.",
  newRecipe: "New recipe",
  findRecipe: "Find a recipe",
  quickIdea: "Quick idea, such as Shakshuka",
  ideaLabel: "Recipe idea",
  addIdea: "Add idea",
  added: (name: string) => `${name} added`,
  idea: "Idea. Add ingredients when you cook it.",
  kcal: "kcal",
  protein: "Protein",
  carbs: "Carbs",
  fat: "Fat",
  minutes: (count: number) => `${count} min`,
  servings: (count: number) => count === 1 ? "1 serving" : `${count} servings`,
  servingsLabel: "Servings",
  noMatch: (query: string) => `No recipe matches “${query}”`,
  noRecipes: "No recipes yet",
  tryAnother: "Try another word.",
  addIdeaHint: "Add an idea above, then fill in the ingredients when you cook it.",
  allRecipes: "All recipes",
  copy: "Copy",
  edit: "Edit",
  ingredients: "Ingredients",
  perServing: "per serving",
  addNutrition: "Add nutrition to every ingredient to see values per serving.",
  noIngredients: "No ingredients yet. Edit the recipe to add them, so the shopping list can count them.",
  steps: "Steps",
  noSteps: "No steps written down yet.",
  deleteConfirm: (name: string) => `Delete ${name}? It also leaves the week plan.`,
  deleted: (name: string) => `${name} deleted`,
  deleteRecipe: "Delete recipe",
  copyTitle: (name: string) => `Copy ${name}`,
  copyDescription: "The other kitchen gets its own copy, with only the ingredients this recipe uses.",
  copiedTo: (name: string) => `Copied to ${name}`,
  cancel: "Cancel",
  saveRecipe: "Save recipe",
  editTitle: (name: string) => `Edit ${name}`,
  amountsHint: "Amounts are for the number of servings you set.",
  name: "Name",
  minutesLabel: "Minutes",
  newNames: "New names become new ingredients",
  stepsPlaceholder: "One step per line.\nDice the onions.\nFry them in olive oil.",
  recipeSaved: "Recipe saved",
  nameRequired: "Give the recipe a name."
};
type KitText = typeof en;
const TEXT: Record<KitchenLanguage, KitText> = {
  en,
  de: {
    title: "Rezepte",
    recipes: (count: number) => count === 1 ? "1 Rezept" : `${count} Rezepte`,
    stillIdeas: (count: number) => count === 1 ? ", 1 noch eine Idee ohne Zutaten" : `, ${count} noch Ideen ohne Zutaten`,
    intro: "Sammle die Gerichte, die du kochst. Ein Name reicht zum Start.",
    newRecipe: "Neues Rezept",
    findRecipe: "Rezept suchen",
    quickIdea: "Schnelle Idee, zum Beispiel Shakshuka",
    ideaLabel: "Rezeptidee",
    addIdea: "Idee hinzufügen",
    added: (name: string) => `${name} hinzugefügt`,
    idea: "Idee. Füge Zutaten hinzu, wenn du es kochst.",
    kcal: "kcal",
    protein: "Eiweiß",
    carbs: "Kohlenhydrate",
    fat: "Fett",
    minutes: (count: number) => `${count} Min.`,
    servings: (count: number) => count === 1 ? "1 Portion" : `${count} Portionen`,
    servingsLabel: "Portionen",
    noMatch: (query: string) => `Kein Rezept passt zu „${query}“`,
    noRecipes: "Noch keine Rezepte",
    tryAnother: "Probier ein anderes Wort.",
    addIdeaHint: "Füge oben eine Idee hinzu und trage die Zutaten ein, wenn du sie kochst.",
    allRecipes: "Alle Rezepte",
    copy: "Kopieren",
    edit: "Bearbeiten",
    ingredients: "Zutaten",
    perServing: "pro Portion",
    addNutrition: "Füge jeder Zutat Nährwerte hinzu, um die Werte pro Portion zu sehen.",
    noIngredients: "Noch keine Zutaten. Bearbeite das Rezept, damit die Einkaufsliste sie zählen kann.",
    steps: "Zubereitung",
    noSteps: "Noch keine Schritte notiert.",
    deleteConfirm: (name: string) => `${name} löschen? Es verschwindet auch aus dem Wochenplan.`,
    deleted: (name: string) => `${name} gelöscht`,
    deleteRecipe: "Rezept löschen",
    copyTitle: (name: string) => `${name} kopieren`,
    copyDescription: "Die andere Küche bekommt eine eigene Kopie, mit nur den Zutaten, die dieses Rezept nutzt.",
    copiedTo: (name: string) => `Kopiert nach ${name}`,
    cancel: "Abbrechen",
    saveRecipe: "Rezept speichern",
    editTitle: (name: string) => `${name} bearbeiten`,
    amountsHint: "Die Mengen gelten für die Anzahl Portionen, die du einstellst.",
    name: "Name",
    minutesLabel: "Minuten",
    newNames: "Neue Namen werden zu neuen Zutaten",
    stepsPlaceholder: "Ein Schritt pro Zeile.\nZwiebeln würfeln.\nIn Olivenöl anbraten.",
    recipeSaved: "Rezept gespeichert",
    nameRequired: "Gib dem Rezept einen Namen."
  }
};

export function KitchenRecipesPage(data: Frame & { recipes: readonly RecipeSummary[] }) {
  const { kitchen, recipes } = data;
  const { run, pending } = useKitchenAction(kitchen.id);
  const text = useText(TEXT);
  const [query, setQuery] = useState("");
  const [idea, setIdea] = useState("");
  const matches = recipes.filter((recipe) => recipe.name.toLowerCase().includes(query.trim().toLowerCase()));
  const ideas = recipes.filter((recipe) => !recipe.ingredientCount).length;

  async function addIdea() {
    const name = idea.trim();
    if (!name) return;
    if (await run({ type: "recipe.save", name, servings: 2, minutes: null, instructions: "", lines: [] }, { title: text.added(name) })) setIdea("");
  }

  return (
    <KitchenPage
      title={text.title}
      facts={recipes.length ? `${text.recipes(recipes.length)}${ideas ? text.stillIdeas(ideas) : ""}` : text.intro}
      actions={<Button nativeButton={false} render={<Link to="/kitchen/$kitchenId/recipes/$recipeId" params={{ kitchenId: kitchen.id, recipeId: "new" }} />}><PlusIcon aria-hidden /> {text.newRecipe}</Button>}
    >
      <div className="grid gap-4">
        <form className="flex gap-2 sm:max-w-md" onSubmit={(event) => { event.preventDefault(); void addIdea(); }}>
          <Input className="h-10" placeholder={text.quickIdea} value={idea} onChange={(event) => setIdea(event.target.value)} aria-label={text.ideaLabel} />
          <Button type="submit" variant="outline" className="h-10" disabled={!idea.trim() || pending}>{text.addIdea}</Button>
        </form>
        <SearchField value={query} onValue={setQuery} label={text.findRecipe}>
        {matches.length ? (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {matches.map((recipe) => {
              const group = mainGroup(kitchen.groups, recipe.sections);
              return (
              <li key={recipe.id}>
                <Link
                  to="/kitchen/$kitchenId/recipes/$recipeId"
                  params={{ kitchenId: kitchen.id, recipeId: recipe.id }}
                  style={{ background: group ? tint(groupColor(kitchen.groups, group), 11) : "var(--muted)" }}
                  className="flex h-full items-start gap-3 rounded-2xl p-4 transition-[filter] hover:brightness-[1.04] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <PlateRing groups={kitchen.groups} sections={recipe.sections} size={36} />
                  <span className="grid min-w-0 flex-1 gap-1.5">
                  <span className="font-kitchen font-semibold tracking-tight text-lg leading-snug break-words">{recipe.name}</span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
                      {recipe.ingredientCount ? (
                        <>
                          {recipe.kcal !== null ? <span><span className="font-semibold text-foreground">{recipe.kcal}</span> {text.kcal}</span> : null}
                          {recipe.protein !== null ? <span><span className="font-semibold text-foreground">{recipe.protein} g</span> {text.protein}</span> : null}
                          {recipe.minutes ? <span className="inline-flex items-center gap-1"><ClockIcon className="size-3" aria-hidden />{text.minutes(recipe.minutes)}</span> : null}
                        </>
                      ) : <span>{text.idea}</span>}
                    </span>
                  </span>
                </Link>
              </li>
              );
            })}
          </ul>
        ) : (
          <KitchenEmpty title={recipes.length ? text.noMatch(query) : text.noRecipes} body={recipes.length ? text.tryAnother : text.addIdeaHint} />
        )}
        </SearchField>
      </div>
    </KitchenPage>
  );
}

type RecipeData = Frame & { recipe: Recipe | undefined; ingredients: readonly Ingredient[]; nutrition: Nutrition | undefined };

export function KitchenRecipePage(data: RecipeData) {
  const [editing, setEditing] = useState(!data.recipe);
  if (!data.recipe || editing) return <RecipeEditor data={data} onDone={() => setEditing(false)} />;
  return <RecipeView data={data} recipe={data.recipe} onEdit={() => setEditing(true)} />;
}

function RecipeView({ data, recipe, onEdit }: { data: RecipeData; recipe: Recipe; onEdit: () => void }) {
  const navigate = useNavigate();
  const language = useLanguage();
  const text = useText(TEXT);
  const { run, pending } = useKitchenAction(data.kitchen.id);
  const [servings, setServings] = useState(recipe.servings);
  const [copying, setCopying] = useState(false);
  const sectionOf = new Map(data.ingredients.map((ingredient) => [ingredient.id, ingredient.section]));
  const lines = byGroup(data.kitchen.groups, scaledLines(recipe, servings), (line) => sectionOf.get(line.ingredientId) ?? "Other").flatMap(([, group]) => group);
  const steps = recipe.instructions.split("\n").map((step) => step.trim()).filter(Boolean);
  const others = data.kitchens.filter((kitchen) => kitchen.id !== data.kitchen.id);
  const n = data.nutrition;

  return (
    <KitchenPage
      back={<Link to="/kitchen/$kitchenId/recipes" params={{ kitchenId: data.kitchen.id }} className="-ml-1 inline-flex min-h-11 items-center gap-1 pr-2 text-sm text-muted-foreground hover:text-foreground"><ChevronLeftIcon className="size-4" aria-hidden />{text.allRecipes}</Link>}
      title={recipe.name}
      facts={[recipe.minutes ? text.minutes(recipe.minutes) : "", text.servings(recipe.servings)].filter(Boolean).join(", ")}
      actions={(
        <>
          {others.length ? <Button variant="outline" onClick={() => setCopying(true)}><CopyIcon aria-hidden /> {text.copy}</Button> : null}
          <Button variant="outline" onClick={onEdit}><PencilIcon aria-hidden /> {text.edit}</Button>
        </>
      )}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section className="grid content-start gap-4 rounded-2xl border border-[color:var(--surface-border)] bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-kitchen font-semibold tracking-tight text-xl">{text.ingredients}</h2>
            <Stepper label={text.servingsLabel} value={servings} onValue={setServings} />
          </div>
          {lines.length ? (
            <ul className="grid gap-2">
              {lines.map((line) => (
                <li key={line.ingredientId} className="flex items-baseline justify-between gap-3 border-b border-dashed border-[color:var(--surface-border)] pb-2 text-sm last:border-0 last:pb-0">
                  <span className="flex min-w-0 items-baseline gap-2 break-words">
                    <GroupDot groups={data.kitchen.groups} group={sectionOf.get(line.ingredientId) ?? "Other"} className="size-2 translate-y-[-1px]" />
                    <span>{line.ingredient}{line.note ? <span className="text-muted-foreground">, {line.note}</span> : null}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{formatAmount(line.amount, line.unit, language)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">{text.noIngredients}</p>}
          {n && n.kcal !== null ? (
            <dl className="grid grid-cols-4 gap-2 rounded-xl bg-muted/60 p-3 text-center">
              {([[text.kcal, n.kcal, ""], [text.protein, n.protein, " g"], [text.carbs, n.carbs, " g"], [text.fat, n.fat, " g"]] as const).map(([label, value, unit]) => (
                <div key={label}>
                  <dt className="text-[0.6875rem] text-muted-foreground">{label}</dt>
                  <dd className="font-kitchen font-semibold tracking-tight text-lg leading-tight tabular-nums">{value === null ? "?" : `${value}${unit}`}</dd>
                </div>
              ))}
              <p className="col-span-4 text-[0.6875rem] text-muted-foreground">{text.perServing}</p>
            </dl>
          ) : lines.length ? <p className="text-xs text-muted-foreground">{text.addNutrition}</p> : null}
        </section>
        <section className="grid content-start gap-3">
          <h2 className="font-kitchen font-semibold tracking-tight text-xl">{text.steps}</h2>
          {steps.length ? (
            <ol className="grid gap-3">
              {steps.map((step, index) => (
                <li key={index} className="flex gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold tabular-nums">{index + 1}</span>
                  <p className="pt-0.5 text-[0.9375rem] leading-relaxed">{step}</p>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-muted-foreground">{text.noSteps}</p>}
          <div className="mt-6 border-t border-[color:var(--surface-border)] pt-4">
            <Button variant="destructive-subtle" disabled={pending} onClick={async () => {
              if (!window.confirm(text.deleteConfirm(recipe.name))) return;
              if (await run({ type: "recipe.delete", id: recipe.id }, { title: text.deleted(recipe.name) })) void navigate({ to: "/kitchen/$kitchenId/recipes", params: { kitchenId: data.kitchen.id } });
            }}><Trash2Icon aria-hidden /> {text.deleteRecipe}</Button>
          </div>
        </section>
      </div>
      <KitchenSheet open={copying} onOpenChange={setCopying} title={text.copyTitle(recipe.name)} description={text.copyDescription}>
        <ul className="grid gap-1 pb-2">
          {others.map((kitchen) => (
            <li key={kitchen.id}>
              <button type="button" disabled={pending} className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left hover:bg-muted/60"
                onClick={async () => { if (await run({ type: "recipe.copy", id: recipe.id, toKitchenId: kitchen.id }, { title: text.copiedTo(kitchen.name) })) setCopying(false); }}>
                <span className="font-medium">{kitchen.name}</span>
                <CopyIcon className="size-4 text-muted-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </KitchenSheet>
    </KitchenPage>
  );
}

function RecipeEditor({ data, onDone }: { data: RecipeData; onDone: () => void }) {
  const navigate = useNavigate();
  const text = useText(TEXT);
  const { run, pending } = useKitchenAction(data.kitchen.id);
  const recipe = data.recipe;
  const [name, setName] = useState(recipe?.name ?? "");
  const [servings, setServings] = useState(recipe?.servings ?? 2);
  const [minutes, setMinutes] = useState(recipe?.minutes ? String(recipe.minutes) : "");
  const [instructions, setInstructions] = useState(recipe?.instructions ?? "");
  const [lines, setLines] = useState<DraftLine[]>(() => draftLines(recipe?.lines ?? []));
  const [error, setError] = useState<string | undefined>();
  const resolveLines = useResolveLines(data.kitchen.id, data.ingredients);

  async function save() {
    setError(undefined);
    if (!name.trim()) return setError(text.nameRequired);
    const resolved = await resolveLines(lines);
    if (typeof resolved === "string") return setError(resolved);
    if (!resolved) return;
    const saved = await run({ type: "recipe.save", id: recipe?.id, name, servings, minutes: minutes ? Number(minutes) : null, instructions, lines: resolved }, { title: recipe ? text.recipeSaved : text.added(name.trim()) });
    if (!saved?.id) return;
    if (recipe) onDone();
    else void navigate({ to: "/kitchen/$kitchenId/recipes/$recipeId", params: { kitchenId: data.kitchen.id, recipeId: saved.id }, replace: true });
  }

  return (
    <KitchenPage
      title={recipe ? text.editTitle(recipe.name) : text.newRecipe}
      facts={text.amountsHint}
      actions={(
        <>
          <Button variant="ghost" onClick={() => recipe ? onDone() : void navigate({ to: "/kitchen/$kitchenId/recipes", params: { kitchenId: data.kitchen.id } })}>{text.cancel}</Button>
          <Button onClick={save} disabled={pending}>{text.saveRecipe}</Button>
        </>
      )}
    >
      <form className="mx-auto grid max-w-3xl gap-6" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto_7rem]">
          <div className="grid gap-1.5">
            <Label htmlFor="recipe-name">{text.name}</Label>
            <Input id="recipe-name" className="h-10" value={name} onChange={(event) => setName(event.target.value)} placeholder="Linsen-Kichererbsen Curry" />
          </div>
          <div className="grid gap-1.5">
            <Label>{text.servingsLabel}</Label>
            <Stepper label={text.servingsLabel} value={servings} onValue={setServings} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="recipe-minutes">{text.minutesLabel}</Label>
            <Input id="recipe-minutes" className="h-10" inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value.replace(/\D/g, ""))} placeholder="30" />
          </div>
        </div>
        <section className="grid gap-2">
          <div className="flex items-center justify-between">
            <h2 className="font-kitchen font-semibold tracking-tight text-xl">{text.ingredients}</h2>
            <span className="text-xs text-muted-foreground">{text.newNames}</span>
          </div>
          <LineEditor lines={lines} onLines={setLines} ingredients={data.ingredients} />
        </section>
        <section className="grid gap-1.5">
          <Label htmlFor="recipe-steps" className="font-semibold">{text.steps}</Label>
          <Textarea id="recipe-steps" rows={8} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder={text.stepsPlaceholder} />
        </section>
        {error ? <p role="alert" className={cn("text-sm text-destructive")}>{error}</p> : null}
        <div className="flex justify-end gap-2 pb-4">
          <Button type="submit" size="lg" className="px-6" disabled={pending}>{text.saveRecipe}</Button>
        </div>
      </form>
    </KitchenPage>
  );
}
