import { ArrowDownIcon, ArrowUpIcon, ListOrderedIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "../../../platform/ui/components/ui/button.js";
import { Input } from "../../../platform/ui/components/ui/input.js";
import { Label } from "../../../platform/ui/components/ui/label.js";
import { Textarea } from "../../../platform/ui/components/ui/textarea.js";
import { type RecipeChoice, searchKitchenCatalog } from "../server-functions.js";
import { CATALOG_SOURCE_NAMES, type CatalogProduct, convertNutrition, fieldNumber, formatNumber, type Ingredient, ingredientGroups, INGREDIENT_UNITS, isCountedUnit, type IngredientUnit, unitName, UNSORTED_SECTION } from "../domain.js";
import { byGroup, type Frame, GROUP_LIST, GroupDot, groupColor, GroupLabel, groupLabel, groupListStyle, KitchenEmpty, KitchenPage, KitchenSheet, SearchField, SheetAction, useKitchenAction } from "./kit.js";
import { type KitchenLanguage, useLanguage, useText } from "./language.js";

export type IngredientsData = Frame & { ingredients: readonly Ingredient[]; recipes: readonly RecipeChoice[] };

const NUTRIENTS = [["kcal", "kcal"], ["protein", "g"], ["carbs", "g"], ["fat", "g"]] as const;

const en = {
  nameIngredient: "Give the ingredient a name.",
  namePlaceholder: "e.g. tomato paste",
  sizePlaceholder: "e.g. 250",
  title: "Ingredients",
  inKitchen: (count: number) => `${count} in this kitchen`,
  withoutNutrition: (count: number) => `, ${count} without nutrition`,
  inTwoGroups: (count: number) => `, ${count} of them in more than one group`,
  intro: "What you cook with, grouped the way you shop.",
  arrangeGroups: "Arrange groups",
  newIngredient: "New ingredient",
  findPlaceholder: "Find or add an ingredient",
  addNew: (name: string) => `Add “${name}” as a new ingredient`,
  kcal: "kcal",
  protein: "Protein",
  carbs: "Carbs",
  fat: "Fat",
  calories: "Calories",
  perOne: (unit: string) => `per ${unit}`,
  per100: (unit: string) => `per 100 ${unit}`,
  noNutrition: "No nutrition yet",
  inRecipes: (count: number) => count === 1 ? "In 1 recipe" : `In ${count} recipes`,
  noMatch: (query: string) => `Nothing matches “${query}”`,
  noIngredients: "No ingredients yet",
  tryAnother: "Try another word.",
  addHere: "Add them here, or type them into a recipe and they appear here.",
  delete: "Delete",
  usedInRecipes: "Used in recipes, so it cannot be deleted.",
  recipesUsingIt: "Recipes with this ingredient",
  deleted: (name: string) => `${name} deleted`,
  save: "Save",
  saved: (name: string) => `${name} saved`,
  added: (name: string) => `${name} added`,
  inRecipesToo: (count: number) => count === 1 ? " and put in 1 recipe" : ` and put in ${count} recipes`,
  recipes: "Recipes",
  alreadyIn: "Already in",
  findRecipe: "Add to a recipe",
  findAnotherRecipe: "Add to another recipe",
  noRecipeMatch: (query: string) => `No other recipe matches “${query}”`,
  addingTo: "Recipes it goes into on save",
  amountsNeeded: "Enter how much each recipe needs.",
  removeRecipe: (recipe: string) => `Do not add to ${recipe}`,
  amountFor: (recipe: string) => `Amount for ${recipe}`,
  forServings: (count: number) => count === 1 ? "for 1 serving" : `for ${count} servings`,
  name: "Name",
  unit: "Unit",
  size: (item: string, other: string) => `1 ${item} is how many ${other}?`,
  sizeHint: "Recipes, stock, and nutrition change to the new unit with this size.",
  groups: "Groups",
  groupPlaceholder: "Type a group, such as Basics",
  anotherGroup: "Another group",
  mainGroup: "main",
  makeMain: (group: string) => `Make ${group} the main group`,
  addGroupNamed: (group: string) => `Add ${group}`,
  removeGroup: (group: string) => `Remove ${group}`,
  groupsHint: "The first group places it on the shopping list. All groups count in the meal balance.",
  nutritionPer: (per: string) => `Nutrition ${per}`,
  leaveEmpty: "Leave empty what you do not know.",
  notes: "Notes",
  notesPlaceholder: "Where to buy it, a brand, a source for the values",
  arrangeDescription: "Put the groups in the order you shop. The shopping list follows it.",
  saveOrder: "Save order",
  orderSaved: "Group order saved",
  moveUp: (group: string) => `Move ${group} up`,
  moveDown: (group: string) => `Move ${group} down`,
  fromProduct: "Fill in from a product",
  catalogSource: "Product data from Billa and from Open Food Facts, under the Open Database License."
};
type KitText = typeof en;
const TEXT: Record<KitchenLanguage, KitText> = {
  en,
  de: {
    nameIngredient: "Gib der Zutat einen Namen.",
    namePlaceholder: "z. B. Tomatenmark",
    sizePlaceholder: "z. B. 250",
    title: "Zutaten",
    inKitchen: (count: number) => `${count} in dieser Küche`,
    withoutNutrition: (count: number) => `, ${count} ohne Nährwerte`,
    inTwoGroups: (count: number) => `, ${count} davon in mehreren Gruppen`,
    intro: "Was du kochst, nach Gruppen sortiert, so wie du einkaufst.",
    arrangeGroups: "Gruppen ordnen",
    newIngredient: "Neue Zutat",
    findPlaceholder: "Zutat suchen oder hinzufügen",
    addNew: (name: string) => `„${name}“ als neue Zutat hinzufügen`,
    kcal: "kcal",
    protein: "Eiweiß",
    carbs: "Kohlenhydrate",
    fat: "Fett",
    calories: "Kalorien",
    perOne: (unit: string) => `pro ${unit}`,
    per100: (unit: string) => `pro 100 ${unit}`,
    noNutrition: "Noch keine Nährwerte",
    inRecipes: (count: number) => count === 1 ? "In 1 Rezept" : `In ${count} Rezepten`,
    noMatch: (query: string) => `Nichts passt zu „${query}“`,
    noIngredients: "Noch keine Zutaten",
    tryAnother: "Probier ein anderes Wort.",
    addHere: "Füge sie hier hinzu oder schreib sie in ein Rezept, dann erscheinen sie hier.",
    delete: "Löschen",
    usedInRecipes: "In Rezepten verwendet, darum nicht löschbar.",
    recipesUsingIt: "Rezepte mit dieser Zutat",
    deleted: (name: string) => `${name} gelöscht`,
    save: "Speichern",
    saved: (name: string) => `${name} gespeichert`,
    added: (name: string) => `${name} hinzugefügt`,
    inRecipesToo: (count: number) => count === 1 ? " und in 1 Rezept aufgenommen" : ` und in ${count} Rezepte aufgenommen`,
    recipes: "Rezepte",
    alreadyIn: "Schon in",
    findRecipe: "Zu einem Rezept hinzufügen",
    findAnotherRecipe: "Zu weiterem Rezept hinzufügen",
    noRecipeMatch: (query: string) => `Kein weiteres Rezept passt zu „${query}“`,
    addingTo: "Rezepte, in die sie beim Speichern kommt",
    amountsNeeded: "Gib an, wie viel jedes Rezept braucht.",
    removeRecipe: (recipe: string) => `Nicht zu ${recipe} hinzufügen`,
    amountFor: (recipe: string) => `Menge für ${recipe}`,
    forServings: (count: number) => count === 1 ? "für 1 Portion" : `für ${count} Portionen`,
    name: "Name",
    unit: "Einheit",
    size: (item: string, other: string) => `Wie viel ${other} sind 1 ${item}?`,
    sizeHint: "Rezepte, Vorrat und Nährwerte wechseln mit dieser Größe zur neuen Einheit.",
    groups: "Gruppen",
    groupPlaceholder: "Gruppe eingeben, z. B. Basics",
    anotherGroup: "Weitere Gruppe",
    mainGroup: "Hauptgruppe",
    makeMain: (group: string) => `${group} als Hauptgruppe`,
    addGroupNamed: (group: string) => `${group} hinzufügen`,
    removeGroup: (group: string) => `${group} entfernen`,
    groupsHint: "Die erste Gruppe bestimmt den Platz auf der Einkaufsliste. Alle zählen für die Balance der Mahlzeit.",
    nutritionPer: (per: string) => `Nährwerte ${per}`,
    leaveEmpty: "Lass leer, was du nicht weißt.",
    notes: "Notizen",
    notesPlaceholder: "Wo du es kaufst, eine Marke, eine Quelle für die Werte",
    arrangeDescription: "Sortiere die Gruppen in der Reihenfolge, in der du einkaufst. Die Einkaufsliste folgt ihr.",
    saveOrder: "Reihenfolge speichern",
    orderSaved: "Gruppenreihenfolge gespeichert",
    moveUp: (group: string) => `${group} nach oben`,
    moveDown: (group: string) => `${group} nach unten`,
    fromProduct: "Aus einem Produkt übernehmen",
    catalogSource: "Produktdaten von Billa und von Open Food Facts, unter der Open Database License."
  }
};

export function KitchenIngredientsPage(data: IngredientsData) {
  const language = useLanguage();
  const text = useText(TEXT);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Ingredient | "new" | undefined>();
  const [newName, setNewName] = useState("");
  const typed = query.trim();
  const create = (name: string) => { setNewName(name); setEditing("new"); };
  const [arranging, setArranging] = useState(false);
  const matches = data.ingredients.filter((one) => [one.name, ...ingredientGroups(one).map((group) => groupLabel(group, language))].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  // An ingredient in more than one group shows in each of them.
  const groups = byGroup(data.kitchen.groups, matches.flatMap((ingredient) => ingredientGroups(ingredient).map((group) => ({ group, ingredient }))), (entry) => entry.group)
    .map(([section, entries]) => [section, entries.map((entry) => entry.ingredient)] as const);
  const missing = data.ingredients.filter((one) => one.nutrition.kcal === null).length;
  const shared = data.ingredients.filter((one) => one.otherGroups.length > 0).length;

  return (
    <KitchenPage
      title={text.title}
      facts={data.ingredients.length ? `${text.inKitchen(data.ingredients.length)}${shared ? text.inTwoGroups(shared) : ""}${missing ? text.withoutNutrition(missing) : ""}` : text.intro}
      actions={(
        <>
          {data.ingredients.length ? <Button variant="outline" onClick={() => setArranging(true)}><ListOrderedIcon aria-hidden /> {text.arrangeGroups}</Button> : null}
          <Button onClick={() => create("")}><PlusIcon aria-hidden /> {text.newIngredient}</Button>
        </>
      )}
    >
      <div className="grid grid-cols-1 gap-5">
        <SearchField value={query} onValue={setQuery} label={text.findPlaceholder}
          add={typed && !data.ingredients.some((one) => one.name.toLowerCase() === typed.toLowerCase()) ? { label: text.addNew(typed), run: () => create(typed) } : undefined}>
        <div className="gap-5 lg:columns-2">
          {groups.map(([section, items]) => (
            <section key={section} aria-label={groupLabel(section, language)} className="mb-5 min-w-0 break-inside-avoid last:mb-0">
              <h2 className="mb-2 font-kitchen font-semibold tracking-tight text-lg leading-tight">
                <GroupLabel color={groupColor(data.kitchen.groups, section)} count={items.length}>{groupLabel(section, language)}</GroupLabel>
              </h2>
              <ul className={GROUP_LIST} style={groupListStyle(groupColor(data.kitchen.groups, section))}>
                {items.map((ingredient) => (
                  <li key={ingredient.id}>
                    <button type="button" onClick={() => setEditing(ingredient)}
                      className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset">
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium wrap-anywhere">{ingredient.name}</span>
                        {ingredient.nutrition.kcal !== null ? (
                          <span className="block text-xs text-muted-foreground tabular-nums">
                            <span className="font-semibold whitespace-nowrap text-foreground">{formatNumber(ingredient.nutrition.kcal, language)} {text.kcal}</span>
                            {ingredient.nutrition.protein !== null ? <>, <span className="whitespace-nowrap">{text.protein} {formatNumber(ingredient.nutrition.protein, language)} g</span></> : null}
                            {ingredient.nutrition.carbs !== null ? <>, <span className="whitespace-nowrap">{text.carbs} {formatNumber(ingredient.nutrition.carbs, language)} g</span></> : null}
                            {ingredient.nutrition.fat !== null ? <>, <span className="whitespace-nowrap">{text.fat} {formatNumber(ingredient.nutrition.fat, language)} g</span></> : null}
                          </span>
                        ) : <span className="block text-xs text-muted-foreground">{text.noNutrition}</span>}
                      </span>
                      <span className="shrink-0 text-right text-xs text-muted-foreground">
                        <span className="block">{isCountedUnit(ingredient.unit) ? text.perOne(unitName(ingredient.unit, language, 1)) : text.per100(ingredient.unit)}</span>
                        {ingredient.recipeCount ? <span className="block">{text.inRecipes(ingredient.recipeCount)}</span> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        {!matches.length ? (
          <KitchenEmpty title={data.ingredients.length ? text.noMatch(query) : text.noIngredients} body={data.ingredients.length ? text.tryAnother : text.addHere} />
        ) : null}
        </SearchField>
      </div>
      <GroupsSheet open={arranging} onClose={() => setArranging(false)} data={data} />
      <IngredientSheet key={editing === "new" ? `new:${newName}` : editing?.id ?? "none"} ingredient={editing} newName={newName} onClose={() => setEditing(undefined)} data={data} />
    </KitchenPage>
  );
}

/** Shows and edits one ingredient: unit, groups, the recipes that use it, nutrition, and notes. */
export function IngredientSheet({ ingredient, newName = "", onClose, data }: { ingredient: Ingredient | "new" | undefined; newName?: string; onClose: () => void; data: IngredientsData }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const { run, pending } = useKitchenAction(data.kitchen.id);
  const existing = ingredient === "new" ? undefined : ingredient;
  const [name, setName] = useState(existing?.name ?? newName);
  const [unit, setUnit] = useState<IngredientUnit>(existing?.unit ?? "g");
  /** The main group first. It places the ingredient on the shopping list. */
  const [groups, setGroups] = useState<readonly string[]>(existing ? ingredientGroups(existing).filter((group) => group !== UNSORTED_SECTION) : []);
  const [typedGroup, setTypedGroup] = useState("");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const field = (value: number | null | undefined) => value == null ? "" : fieldNumber(value, language);
  const shown = (nutrition: Ingredient["nutrition"] | undefined) => ({
    kcal: field(nutrition?.kcal), protein: field(nutrition?.protein), carbs: field(nutrition?.carbs), fat: field(nutrition?.fat)
  });
  const [values, setValues] = useState<Record<(typeof NUTRIENTS)[number][0], string>>(shown(existing?.nutrition));
  const [size, setSize] = useState("");
  /** The name of the product the fields came from. The product list stays away until the name changes again. */
  const [pickedName, setPickedName] = useState<string>();
  /** The recipes that get this ingredient on save, in the order they were picked, each with the amount as typed. */
  const [uses, setUses] = useState<ReadonlyMap<string, string>>(new Map());
  const number = (value: string) => value.trim() === "" ? null : Number(value.replace(",", "."));
  const nutrientLabel = { kcal: text.calories, protein: text.protein, carbs: text.carbs, fat: text.fat };
  const per = isCountedUnit(unit) ? text.perOne(unitName(unit, language, 1)) : text.per100(unit);
  const changingUnit = existing !== undefined && unit !== existing.unit;
  const larger = existing && isCountedUnit(existing.unit) ? existing.unit : unit;
  const smaller = larger === unit ? existing?.unit ?? unit : unit;
  /** How much of the old unit one new unit holds. The field asks for the larger unit in the smaller one. */
  const oldPerNew = (input: string) => {
    const value = number(input);
    if (!value || !Number.isFinite(value) || value <= 0) return undefined;
    return larger === unit ? value : 1 / value;
  };

  function chooseUnit(next: IngredientUnit) {
    setUnit(next);
    setSize("");
    setValues(shown(existing?.nutrition));
  }

  function pick(product: CatalogProduct) {
    setName(product.name);
    setUnit(product.unit);
    setSize("");
    setValues(shown(product.nutrition));
    setPickedName(product.name);
  }

  function changeSize(input: string) {
    setSize(input);
    const factor = oldPerNew(input);
    if (existing && factor) setValues(shown(convertNutrition(existing.nutrition, existing.unit, unit, factor)));
  }

  const addToRecipes = [...uses].map(([recipeId, amount]) => ({ recipeId, amount: number(amount) ?? Number.NaN }));
  const amountsReady = addToRecipes.every((use) => Number.isFinite(use.amount) && use.amount > 0);

  async function save() {
    const [section = "", ...otherGroups] = withGroup(groups, typedGroup);
    const title = (existing ? text.saved(name.trim()) : text.added(name.trim())) + (addToRecipes.length ? text.inRecipesToo(addToRecipes.length) : "");
    const done = await run({
      type: "ingredient.save", id: existing?.id, name, unit, section, otherGroups, notes, oldPerNew: changingUnit ? oldPerNew(size) : undefined,
      kcal: number(values.kcal), protein: number(values.protein), carbs: number(values.carbs), fat: number(values.fat), addToRecipes
    }, { title });
    if (done) onClose();
  }

  return (
    <KitchenSheet
      open={ingredient !== undefined}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={existing ? existing.name : text.newIngredient}
      footer={(
        <div className="flex w-full items-center justify-between gap-2">
          {existing && existing.recipeCount > 0 ? <p className="max-w-48 text-xs text-muted-foreground">{text.usedInRecipes}</p> : existing ? (
            <Button variant="destructive-outline" disabled={pending}
              onClick={async () => { if (await run({ type: "ingredient.delete", id: existing.id }, { title: text.deleted(existing.name) })) onClose(); }}>
              {text.delete}
            </Button>
          ) : <span />}
          <SheetAction pending={pending} missing={!name.trim() ? text.nameIngredient : !amountsReady ? text.amountsNeeded : undefined} onClick={save}>{text.save}</SheetAction>
        </div>
      )}
    >
      <form className="grid gap-6 pb-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="grid grid-cols-1 gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ingredient-name">{text.name}</Label>
            <Input id="ingredient-name" className="h-11 text-base font-medium" value={name} onChange={(event) => setName(event.target.value)} placeholder={text.namePlaceholder} />
            {!existing && name !== pickedName ? <CatalogProducts query={name} onPick={pick} /> : null}
          </div>
          <div className="grid gap-1.5">
            <Label>{text.unit}</Label>
            <div className="grid max-w-xs grid-cols-4 gap-1 rounded-full bg-muted/60 p-1" role="radiogroup" aria-label={text.unit}>
              {INGREDIENT_UNITS.map((option) => (
                <button key={option} type="button" role="radio" aria-checked={unit === option} onClick={() => chooseUnit(option)}
                  className="h-8 rounded-full text-sm font-medium text-muted-foreground aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-sm">
                  {unitName(option, language)}
                </button>
              ))}
            </div>
          </div>
          {changingUnit ? (
            <div className="grid gap-1.5">
              <Label htmlFor="ingredient-size">{text.size(unitName(larger, language, 1), unitName(smaller, language))}</Label>
              <Input id="ingredient-size" className="h-10 max-w-40 tabular-nums" inputMode="decimal" value={size} onChange={(event) => changeSize(event.target.value)} placeholder={text.sizePlaceholder} />
              <p className="text-xs text-muted-foreground">{text.sizeHint}</p>
            </div>
          ) : null}
          <GroupField groups={groups} onGroups={setGroups} typed={typedGroup} onTyped={setTypedGroup} data={data} />
        </div>
        <RecipeUses existing={existing} unit={unit} uses={uses} onUses={setUses} data={data} />
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{text.nutritionPer(per)}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {NUTRIENTS.map(([key, suffix]) => (
              <label key={key} className="grid gap-1 text-xs text-muted-foreground">
                {nutrientLabel[key]}
                <span className="relative">
                  <Input className="h-10 pr-11 tabular-nums" inputMode="decimal" value={values[key]} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} placeholder="–" />
                  <span aria-hidden className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{text.leaveEmpty}</p>
        </fieldset>
        <div className="grid gap-1.5">
          <Label htmlFor="ingredient-notes">{text.notes}</Label>
          <Textarea id="ingredient-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={text.notesPlaceholder} />
        </div>
      </form>
    </KitchenSheet>
  );
}

/** Packaged foods that match the typed name. Picking one fills in the name, the unit, and the nutrition. */
function CatalogProducts({ query, onPick }: { query: string; onPick: (product: CatalogProduct) => void }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const [products, setProducts] = useState<readonly CatalogProduct[]>([]);
  useEffect(() => {
    const typed = query.trim();
    let current = true;
    const timer = setTimeout(() => {
      if (typed.length < 2) return setProducts([]);
      searchKitchenCatalog({ data: { query: typed } }).then((found) => { if (current) setProducts(found); }, () => { if (current) setProducts([]); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [query]);
  if (!products.length) return null;

  return (
    <div className="grid gap-1 pt-1">
      <p className="text-xs font-medium text-muted-foreground">{text.fromProduct}</p>
      <ul className="grid overflow-hidden rounded-xl border bg-background">
        {products.map((product) => (
          <li key={product.code} className="border-b last:border-b-0">
            <button type="button" onClick={() => onPick(product)} className="grid w-full gap-0.5 px-3 py-2 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none">
              <span className="text-sm font-medium">{product.name}</span>
              <span className="text-xs text-muted-foreground">
                {[product.brand, product.quantity, product.nutrition.kcal !== null ? `${formatNumber(product.nutrition.kcal, language)} ${text.kcal} ${text.per100(product.unit)}` : "", CATALOG_SOURCE_NAMES[product.source]].filter(Boolean).join(" · ")}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        <a className="underline underline-offset-2" href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">{text.catalogSource}</a>
      </p>
    </div>
  );
}

/** The groups with a typed name added at the end, unless it is empty or already there. */
function withGroup(groups: readonly string[], typed: string): string[] {
  const group = typed.trim();
  return group && !groups.some((one) => one.toLowerCase() === group.toLowerCase()) ? [...groups, group] : [...groups];
}

/**
 * The groups of an ingredient as chips. The first chip is the main group, which places the ingredient on the
 * shopping list. A tap on another chip makes it the main group. The kitchen's other groups wait below as suggestions.
 */
function GroupField({ groups, onGroups, typed, onTyped, data }: {
  groups: readonly string[]; onGroups: (groups: readonly string[]) => void; typed: string; onTyped: (typed: string) => void; data: IngredientsData;
}) {
  const language = useLanguage();
  const text = useText(TEXT);
  const known = byGroup(data.kitchen.groups, data.ingredients.flatMap((one) => ingredientGroups(one).map((group) => ({ group }))), (entry) => entry.group)
    .map(([group]) => group).filter((group) => group !== UNSORTED_SECTION);
  const suggestions = [...new Set([...data.kitchen.groups, ...known])].filter((group) => !groups.some((one) => one.toLowerCase() === group.toLowerCase()));
  const add = (group: string) => { onGroups(withGroup(groups, group)); onTyped(""); };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="ingredient-group">{text.groups}</Label>
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-field p-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        {groups.map((group, index) => (
          <span key={group} className="inline-flex h-8 items-center rounded-full border border-control-border bg-control text-sm">
            <button type="button" disabled={index === 0} title={index ? text.makeMain(groupLabel(group, language)) : undefined}
              onClick={() => onGroups([group, ...groups.filter((one) => one !== group)])}
              className="inline-flex h-full items-center gap-1.5 rounded-l-full pl-2.5 enabled:hover:text-foreground">
              <GroupDot groups={data.kitchen.groups} group={group} className="size-2" />
              {groupLabel(group, language)}
              {index === 0 && groups.length > 1 ? <span className="text-xs text-muted-foreground">{text.mainGroup}</span> : null}
            </button>
            <button type="button" aria-label={text.removeGroup(group)} onClick={() => onGroups(groups.filter((one) => one !== group))}
              className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-control-hover hover:text-foreground"><XIcon className="size-3.5" aria-hidden /></button>
          </span>
        ))}
        <input id="ingredient-group" value={typed} onChange={(event) => onTyped(event.target.value)} placeholder={groups.length ? text.anotherGroup : text.groupPlaceholder}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(typed); }
            if (event.key === "Backspace" && !typed && groups.length) onGroups(groups.slice(0, -1));
          }}
          className="h-8 min-w-28 flex-1 bg-transparent px-1.5 text-sm outline-none placeholder:text-muted-foreground" />
      </div>
      {suggestions.length ? (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((group) => (
            <button key={group} type="button" onClick={() => add(group)} aria-label={text.addGroupNamed(groupLabel(group, language))}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-dashed border-control-border px-2.5 text-xs text-muted-foreground hover:border-solid hover:bg-control hover:text-foreground">
              <PlusIcon className="size-3" aria-hidden />{groupLabel(group, language)}
            </button>
          ))}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{text.groupsHint}</p>
    </div>
  );
}

/**
 * The recipes this ingredient is in, and a search to put it into more. Each picked recipe gets a row with the amount
 * it needs. They are saved together with the ingredient.
 */
function RecipeUses({ existing, unit, uses, onUses, data }: {
  existing: Ingredient | undefined; unit: IngredientUnit; uses: ReadonlyMap<string, string>; onUses: (uses: ReadonlyMap<string, string>) => void; data: IngredientsData;
}) {
  const language = useLanguage();
  const text = useText(TEXT);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<string>();
  const usedIn = existing ? data.recipes.filter((recipe) => recipe.ingredientIds.includes(existing.id)) : [];
  const open = data.recipes.filter((recipe) => !usedIn.includes(recipe) && !uses.has(recipe.id));
  const typed = query.trim().toLowerCase();
  const matches = typed ? open.filter((recipe) => recipe.name.toLowerCase().includes(typed)).slice(0, 6) : [];
  const picked = [...uses].flatMap(([id, amount]) => { const recipe = data.recipes.find((one) => one.id === id); return recipe ? [{ recipe, amount }] : []; });
  const missing = picked.some(({ amount }) => !(Number(amount.replace(",", ".")) > 0));
  const pick = (id: string) => { onUses(new Map(uses).set(id, "")); setQuery(""); setFocus(id); };
  if (!data.recipes.length) return null;
  return (
    <section className="grid gap-2" aria-labelledby="ingredient-recipes">
      <h3 id="ingredient-recipes" className="text-sm font-medium">{text.recipes}</h3>
      {usedIn.length ? (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label={text.recipesUsingIt}>
          <li aria-hidden className="pr-1 text-xs text-muted-foreground">{text.alreadyIn}</li>
          {usedIn.map((recipe) => (
            <li key={recipe.id}>
              <Link to="/kitchen/$kitchenId/recipes/$recipeId" params={{ kitchenId: data.kitchen.id, recipeId: recipe.id }}
                className="inline-flex min-h-8 items-center rounded-full border border-control-border bg-control px-3 text-sm hover:bg-control-hover focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                {recipe.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {picked.length ? (
        <ul className="divide-y divide-[color:var(--surface-border)] rounded-xl border border-[color:var(--surface-border)] bg-card" aria-label={text.addingTo}>
          {picked.map(({ recipe, amount }) => (
            <li key={recipe.id} className="flex items-center gap-3 py-2 pr-1.5 pl-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium wrap-anywhere">{recipe.name}</span>
                <span className="block text-xs text-muted-foreground">{text.forServings(recipe.servings)}</span>
              </span>
              <span className="relative shrink-0">
                <Input className="h-9 w-24 pr-10 text-right tabular-nums" inputMode="decimal" autoFocus={focus === recipe.id} aria-label={text.amountFor(recipe.name)} value={amount} placeholder="–"
                  onChange={(event) => onUses(new Map(uses).set(recipe.id, event.target.value))} />
                <span aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">{unitName(unit, language)}</span>
              </span>
              <Button type="button" size="icon" variant="ghost" aria-label={text.removeRecipe(recipe.name)} onClick={() => { const next = new Map(uses); next.delete(recipe.id); onUses(next); }}><XIcon /></Button>
            </li>
          ))}
        </ul>
      ) : null}
      {missing ? <p className="text-xs text-muted-foreground">{text.amountsNeeded}</p> : null}
      {open.length ? (
        <div className="grid gap-1">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" autoComplete="off" className="h-10 pl-9" value={query} onChange={(event) => setQuery(event.target.value)}
              aria-label={text.findRecipe} placeholder={usedIn.length || picked.length ? text.findAnotherRecipe : text.findRecipe}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (matches[0]) pick(matches[0].id); } }} />
          </div>
          {typed ? (
            matches.length ? (
              <ul className="grid rounded-xl border border-[color:var(--surface-border)] bg-popover p-1" aria-label={text.findRecipe}>
                {matches.map((recipe) => (
                  <li key={recipe.id}>
                    <button type="button" onClick={() => pick(recipe.id)}
                      className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none">
                      <PlusIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 wrap-anywhere">{recipe.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="px-1 text-xs text-muted-foreground">{text.noRecipeMatch(query.trim())}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Orders the groups. The shopping list, the stock, and the colors follow this order. */
function GroupsSheet({ open, onClose, data }: { open: boolean; onClose: () => void; data: IngredientsData }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const { run, pending } = useKitchenAction(data.kitchen.id);
  const counts = byGroup(data.kitchen.groups, data.ingredients.flatMap((one) => ingredientGroups(one)), (group) => group).filter(([group]) => group !== UNSORTED_SECTION);
  const [order, setOrder] = useState<string[]>([]);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) { setWasOpen(open); if (open) setOrder(counts.map(([group]) => group)); }
  const size = new Map(counts.map(([group, items]) => [group, items.length]));
  const move = (index: number, by: number) => setOrder((current) => {
    const next = [...current];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    return next;
  });
  return (
    <KitchenSheet open={open} onOpenChange={(next) => { if (!next) onClose(); }} title={text.arrangeGroups}
      description={text.arrangeDescription}
      footer={<Button size="lg" className="px-5" disabled={pending} onClick={async () => { if (await run({ type: "groups.set", groups: order }, { title: text.orderSaved })) onClose(); }}>{text.saveOrder}</Button>}>
      <ol className="grid gap-1.5 pb-2">
        {order.map((group, index) => (
          <li key={group} className="flex items-center gap-3 rounded-xl border border-[color:var(--surface-border)] bg-card py-1.5 pr-1.5 pl-3">
            <GroupDot groups={order} group={group} />
            <span className="min-w-0 flex-1 text-sm font-medium wrap-anywhere">{groupLabel(group, language)} <span className="font-normal text-muted-foreground tabular-nums">{size.get(group)}</span></span>
            <Button size="icon" variant="ghost" aria-label={text.moveUp(group)} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUpIcon /></Button>
            <Button size="icon" variant="ghost" aria-label={text.moveDown(group)} disabled={index === order.length - 1} onClick={() => move(index, 1)}><ArrowDownIcon /></Button>
          </li>
        ))}
      </ol>
    </KitchenSheet>
  );
}
