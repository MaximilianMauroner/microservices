import { ArrowDownIcon, ArrowUpIcon, ListOrderedIcon, PlusIcon, XIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "../../../platform/ui/components/ui/button.js";
import { Input } from "../../../platform/ui/components/ui/input.js";
import { Label } from "../../../platform/ui/components/ui/label.js";
import { Textarea } from "../../../platform/ui/components/ui/textarea.js";
import { convertNutrition, formatNumber, type Ingredient, ingredientGroups, INGREDIENT_UNITS, isCountedUnit, type IngredientUnit, unitName, UNSORTED_SECTION } from "../domain.js";
import { byGroup, type Frame, GROUP_LIST, GroupDot, groupColor, GroupLabel, groupLabel, groupListStyle, KitchenEmpty, KitchenPage, KitchenSheet, SearchField, useKitchenAction } from "./kit.js";
import { type KitchenLanguage, useLanguage, useText } from "./language.js";

/** `usedIn` lists, for each ingredient id, the recipes that use it. */
export type IngredientsData = Frame & { ingredients: readonly Ingredient[]; usedIn: Readonly<Record<string, readonly { id: string; name: string }[]>> };

const NUTRIENTS = [["kcal", "kcal"], ["protein", "g"], ["carbs", "g"], ["fat", "g"]] as const;

const en = {
  title: "Ingredients",
  inKitchen: (count: number) => `${count} in this kitchen`,
  withoutNutrition: (count: number) => `, ${count} without nutrition`,
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
  usedInRecipes: "Used in recipes",
  recipesUsingIt: "Recipes with this ingredient",
  deleted: (name: string) => `${name} deleted`,
  save: "Save",
  saved: (name: string) => `${name} saved`,
  added: (name: string) => `${name} added`,
  name: "Name",
  unit: "Unit",
  size: (item: string, other: string) => `1 ${item} is how many ${other}?`,
  sizeHint: "Recipes, stock, and nutrition change to the new unit with this size.",
  group: "Group",
  alsoIn: "Also in",
  addGroup: "Add group",
  removeGroup: (group: string) => `Remove ${group}`,
  alsoInHint: "These groups count in the meal balance too. The shopping list uses the first group.",
  nutritionPer: (per: string) => `Nutrition ${per}`,
  leaveEmpty: "Leave a value empty when you do not know it. Recipes then show it as unknown.",
  notes: "Notes",
  notesPlaceholder: "Where to buy it, a brand, a source for the values",
  arrangeDescription: "Put the groups in the order you shop. The shopping list follows it.",
  saveOrder: "Save order",
  orderSaved: "Group order saved",
  moveUp: (group: string) => `Move ${group} up`,
  moveDown: (group: string) => `Move ${group} down`
};
type KitText = typeof en;
const TEXT: Record<KitchenLanguage, KitText> = {
  en,
  de: {
    title: "Zutaten",
    inKitchen: (count: number) => `${count} in dieser Küche`,
    withoutNutrition: (count: number) => `, ${count} ohne Nährwerte`,
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
    usedInRecipes: "In Rezepten verwendet",
    recipesUsingIt: "Rezepte mit dieser Zutat",
    deleted: (name: string) => `${name} gelöscht`,
    save: "Speichern",
    saved: (name: string) => `${name} gespeichert`,
    added: (name: string) => `${name} hinzugefügt`,
    name: "Name",
    unit: "Einheit",
    size: (item: string, other: string) => `Wie viel ${other} sind 1 ${item}?`,
    sizeHint: "Rezepte, Vorrat und Nährwerte wechseln mit dieser Größe zur neuen Einheit.",
    group: "Gruppe",
    alsoIn: "Auch in",
    addGroup: "Gruppe hinzufügen",
    removeGroup: (group: string) => `${group} entfernen`,
    alsoInHint: "Diese Gruppen zählen auch für die Balance der Mahlzeit. Die Einkaufsliste nutzt die erste Gruppe.",
    nutritionPer: (per: string) => `Nährwerte ${per}`,
    leaveEmpty: "Lass ein Feld leer, wenn du den Wert nicht kennst. Rezepte zeigen ihn dann als unbekannt.",
    notes: "Notizen",
    notesPlaceholder: "Wo du es kaufst, eine Marke, eine Quelle für die Werte",
    arrangeDescription: "Sortiere die Gruppen in der Reihenfolge, in der du einkaufst. Die Einkaufsliste folgt ihr.",
    saveOrder: "Reihenfolge speichern",
    orderSaved: "Gruppenreihenfolge gespeichert",
    moveUp: (group: string) => `${group} nach oben`,
    moveDown: (group: string) => `${group} nach unten`
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

  return (
    <KitchenPage
      title={text.title}
      facts={data.ingredients.length ? `${text.inKitchen(data.ingredients.length)}${missing ? text.withoutNutrition(missing) : ""}` : text.intro}
      actions={(
        <>
          {data.ingredients.length ? <Button variant="outline" onClick={() => setArranging(true)}><ListOrderedIcon aria-hidden /> {text.arrangeGroups}</Button> : null}
          <Button onClick={() => create("")}><PlusIcon aria-hidden /> {text.newIngredient}</Button>
        </>
      )}
    >
      <div className="grid gap-5">
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
                        <span className="block font-medium break-words">{ingredient.name}</span>
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

/** Shows and edits one ingredient: unit, groups, nutrition, notes, and the recipes that use it. */
export function IngredientSheet({ ingredient, newName = "", onClose, data }: { ingredient: Ingredient | "new" | undefined; newName?: string; onClose: () => void; data: IngredientsData }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const { run, pending } = useKitchenAction(data.kitchen.id);
  const existing = ingredient === "new" ? undefined : ingredient;
  const [name, setName] = useState(existing?.name ?? newName);
  const [unit, setUnit] = useState<IngredientUnit>(existing?.unit ?? "g");
  const [section, setSection] = useState(existing && existing.section !== UNSORTED_SECTION ? existing.section : "");
  const [otherGroups, setOtherGroups] = useState<readonly string[]>(existing?.otherGroups ?? []);
  const [newGroup, setNewGroup] = useState("");
  const addGroup = () => {
    const group = newGroup.trim();
    if (group && ![section, ...otherGroups].some((one) => one.toLowerCase() === group.toLowerCase())) setOtherGroups((current) => [...current, group]);
    setNewGroup("");
  };
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const shown = (nutrition: Ingredient["nutrition"] | undefined) => ({
    kcal: nutrition?.kcal?.toString() ?? "", protein: nutrition?.protein?.toString() ?? "",
    carbs: nutrition?.carbs?.toString() ?? "", fat: nutrition?.fat?.toString() ?? ""
  });
  const [values, setValues] = useState<Record<(typeof NUTRIENTS)[number][0], string>>(shown(existing?.nutrition));
  const [size, setSize] = useState("");
  const sections = byGroup(data.kitchen.groups, data.ingredients, (one) => one.section).map(([group]) => group).filter((group) => group !== UNSORTED_SECTION);
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

  function changeSize(input: string) {
    setSize(input);
    const factor = oldPerNew(input);
    if (existing && factor) setValues(shown(convertNutrition(existing.nutrition, existing.unit, unit, factor)));
  }

  async function save() {
    const done = await run({
      type: "ingredient.save", id: existing?.id, name, unit, section, otherGroups: newGroup.trim() ? [...otherGroups, newGroup.trim()] : [...otherGroups], notes, oldPerNew: changingUnit ? oldPerNew(size) : undefined,
      kcal: number(values.kcal), protein: number(values.protein), carbs: number(values.carbs), fat: number(values.fat)
    }, { title: existing ? text.saved(name.trim()) : text.added(name.trim()) });
    if (done) onClose();
  }

  return (
    <KitchenSheet
      open={ingredient !== undefined}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={existing ? existing.name : text.newIngredient}
      footer={(
        <div className="flex w-full items-center justify-between gap-2">
          {existing ? (
            <Button variant="destructive-subtle" disabled={pending || existing.recipeCount > 0} title={existing.recipeCount ? text.usedInRecipes : undefined}
              onClick={async () => { if (await run({ type: "ingredient.delete", id: existing.id }, { title: text.deleted(existing.name) })) onClose(); }}>
              {text.delete}
            </Button>
          ) : <span />}
          <Button size="lg" className="px-5" disabled={!name.trim() || pending} onClick={save}>{text.save}</Button>
        </div>
      )}
    >
      <form className="grid gap-4 pb-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="grid gap-1.5">
          <Label htmlFor="ingredient-name">{text.name}</Label>
          <Input id="ingredient-name" className="h-10" value={name} onChange={(event) => setName(event.target.value)} placeholder="Kichererbsen" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>{text.unit}</Label>
            <div className="grid grid-cols-4 gap-1 rounded-full bg-muted/60 p-1" role="radiogroup" aria-label={text.unit}>
              {INGREDIENT_UNITS.map((option) => (
                <button key={option} type="button" role="radio" aria-checked={unit === option} onClick={() => chooseUnit(option)}
                  className="h-8 rounded-full text-sm font-medium text-muted-foreground aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-sm">
                  {unitName(option, language)}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ingredient-group">{text.group}</Label>
            <Input id="ingredient-group" className="h-10" list="kitchen-groups" value={section} onChange={(event) => setSection(event.target.value)} placeholder="Proteine, Gemüse, …" />
            <datalist id="kitchen-groups">{sections.map((one) => <option key={one} value={one} />)}</datalist>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ingredient-other-group">{text.alsoIn}</Label>
          {otherGroups.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {otherGroups.map((group) => (
                <li key={group} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-control-border bg-control pr-1 pl-3 text-sm">
                  <GroupDot groups={data.kitchen.groups} group={group} className="size-2" />
                  {groupLabel(group, language)}
                  <button type="button" aria-label={text.removeGroup(group)} onClick={() => setOtherGroups((current) => current.filter((one) => one !== group))}
                    className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-control-hover hover:text-foreground"><XIcon className="size-3.5" aria-hidden /></button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <Input id="ingredient-other-group" className="h-10" list="kitchen-groups" value={newGroup} onChange={(event) => setNewGroup(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addGroup(); } }} placeholder="Kohlenhydrate" />
            <Button type="button" variant="outline" className="h-10" disabled={!newGroup.trim()} onClick={addGroup}><PlusIcon aria-hidden /> {text.addGroup}</Button>
          </div>
          <p className="text-xs text-muted-foreground">{text.alsoInHint}</p>
        </div>
        {changingUnit ? (
          <div className="grid gap-1.5">
            <Label htmlFor="ingredient-size">{text.size(unitName(larger, language, 1), unitName(smaller, language))}</Label>
            <Input id="ingredient-size" className="h-10 max-w-40 tabular-nums" inputMode="decimal" value={size} onChange={(event) => changeSize(event.target.value)} placeholder="250" />
            <p className="text-xs text-muted-foreground">{text.sizeHint}</p>
          </div>
        ) : null}
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{text.nutritionPer(per)}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {NUTRIENTS.map(([key, suffix]) => (
              <label key={key} className="grid gap-1 text-xs text-muted-foreground">
                {nutrientLabel[key]} ({suffix})
                <Input className="h-10 tabular-nums" inputMode="decimal" value={values[key]} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} placeholder="?" />
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{text.leaveEmpty}</p>
        </fieldset>
        <div className="grid gap-1.5">
          <Label htmlFor="ingredient-notes">{text.notes}</Label>
          <Textarea id="ingredient-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={text.notesPlaceholder} />
        </div>
        {existing && data.usedIn[existing.id]?.length ? (
          <section className="grid gap-1.5" aria-labelledby="ingredient-recipes">
            <h3 id="ingredient-recipes" className="text-sm font-medium">{text.recipesUsingIt}</h3>
            <ul className="flex flex-wrap gap-1.5">
              {data.usedIn[existing.id]!.map((recipe) => (
                <li key={recipe.id}>
                  <Link to="/kitchen/$kitchenId/recipes/$recipeId" params={{ kitchenId: data.kitchen.id, recipeId: recipe.id }}
                    className="inline-flex min-h-9 items-center rounded-full border border-control-border bg-control px-3 text-sm hover:bg-control-hover focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                    {recipe.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </form>
    </KitchenSheet>
  );
}

/** Orders the groups. The shopping list, the stock, and the colors follow this order. */
function GroupsSheet({ open, onClose, data }: { open: boolean; onClose: () => void; data: IngredientsData }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const { run, pending } = useKitchenAction(data.kitchen.id);
  const counts = byGroup(data.kitchen.groups, data.ingredients, (one) => one.section).filter(([group]) => group !== UNSORTED_SECTION);
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
            <span className="min-w-0 flex-1 text-sm font-medium break-words">{groupLabel(group, language)} <span className="font-normal text-muted-foreground tabular-nums">{size.get(group)}</span></span>
            <Button size="icon" variant="ghost" aria-label={text.moveUp(group)} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUpIcon /></Button>
            <Button size="icon" variant="ghost" aria-label={text.moveDown(group)} disabled={index === order.length - 1} onClick={() => move(index, 1)}><ArrowDownIcon /></Button>
          </li>
        ))}
      </ol>
    </KitchenSheet>
  );
}
