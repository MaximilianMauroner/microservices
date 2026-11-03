import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "../../../platform/ui/components/ui/button.js";
import { Input } from "../../../platform/ui/components/ui/input.js";
import { type Ingredient, INGREDIENT_UNITS, type IngredientUnit, type RecipeLine, type RecipeLineInput, unitName } from "../domain.js";
import { useKitchenAction } from "./kit.js";
import { type KitchenLanguage, useLanguage, useText } from "./language.js";

const en = {
  ingredient: "Ingredient",
  amount: "Amount",
  removeItem: (name: string) => name ? `Remove ${name}` : "Remove ingredient",
  unit: "Unit",
  note: "Note",
  notePlaceholder: "Note, such as diced",
  addIngredient: "Add ingredient",
  amountRequired: (name: string) => `Enter an amount for ${name}.`
};

const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: {
    ingredient: "Zutat",
    amount: "Menge",
    removeItem: (name: string) => name ? `${name} entfernen` : "Zutat entfernen",
    unit: "Einheit",
    note: "Notiz",
    notePlaceholder: "Notiz, zum Beispiel gewürfelt",
    addIngredient: "Zutat hinzufügen",
    amountRequired: (name: string) => `Gib eine Menge für ${name} ein.`
  }
};

/** One ingredient line while a person edits it. A new name has no ingredient yet. */
export type DraftLine = { key: string; ingredientId?: string; name: string; unit: IngredientUnit; amount: string; note: string };

export function draftLines(lines: readonly RecipeLine[]): DraftLine[] {
  return lines.map((line) => ({ key: line.ingredientId, ingredientId: line.ingredientId, name: line.ingredient, unit: line.unit, amount: String(line.amount), note: line.note }));
}

/** Edits a list of ingredient lines, for a recipe or for one planned meal. Rows lay out by the width they get. */
export function LineEditor({ lines, onLines, ingredients }: { lines: readonly DraftLine[]; onLines: (update: (current: DraftLine[]) => DraftLine[]) => void; ingredients: readonly Ingredient[] }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const byName = new Map(ingredients.map((ingredient) => [ingredient.name.toLowerCase(), ingredient]));
  const update = (key: string, patch: Partial<DraftLine>) => onLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  return (
    <div className="@container grid gap-2">
      <datalist id="kitchen-ingredients">{ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.name} />)}</datalist>
      <ul className="grid gap-2">
        {lines.map((line) => {
          const known = line.ingredientId ? ingredients.find((one) => one.id === line.ingredientId) : byName.get(line.name.trim().toLowerCase());
          return (
            <li key={line.key} className="grid grid-cols-[minmax(0,1fr)_5.5rem_auto] gap-2 rounded-xl border border-[color:var(--surface-border)] bg-card p-2 @xl:grid-cols-[minmax(0,1fr)_6rem_6.5rem_minmax(0,0.8fr)_auto]">
              <Input aria-label={text.ingredient} list="kitchen-ingredients" value={line.name} placeholder={text.ingredient}
                onChange={(event) => {
                  const match = byName.get(event.target.value.trim().toLowerCase());
                  update(line.key, { name: event.target.value, ingredientId: match?.id, unit: match?.unit ?? line.unit });
                }} />
              <Input aria-label={text.amount} inputMode="decimal" value={line.amount} placeholder="200" onChange={(event) => update(line.key, { amount: event.target.value })} />
              <Button type="button" variant="ghost" size="icon" aria-label={text.removeItem(line.name)} className="@xl:order-last" onClick={() => onLines((current) => current.filter((one) => one.key !== line.key))}><XIcon /></Button>
              {known ? (
                <span className="col-span-1 flex h-9 items-center px-1 text-sm text-muted-foreground">{unitName(known.unit, language)}</span>
              ) : (
                <select aria-label={text.unit} value={line.unit} onChange={(event) => update(line.key, { unit: event.target.value as IngredientUnit })}
                  className="h-9 rounded-lg border border-input bg-field px-2 text-sm">
                  {INGREDIENT_UNITS.map((unit) => <option key={unit} value={unit}>{unitName(unit, language)}</option>)}
                </select>
              )}
              <Input aria-label={text.note} value={line.note} placeholder={text.notePlaceholder} className="col-span-2 @xl:col-span-1" onChange={(event) => update(line.key, { note: event.target.value })} />
            </li>
          );
        })}
      </ul>
      <Button type="button" variant="outline" className="justify-self-start" onClick={() => onLines((current) => [...current, { key: crypto.randomUUID(), name: "", unit: "g", amount: "", note: "" }])}>
        <PlusIcon aria-hidden /> {text.addIngredient}
      </Button>
    </div>
  );
}

/**
 * Turns drafts into saved lines. A new name becomes a new ingredient first.
 * Returns an error text when an amount is missing, or undefined when creating an ingredient failed.
 */
export function useResolveLines(kitchenId: string, ingredients: readonly Ingredient[]) {
  const { run } = useKitchenAction(kitchenId);
  const text = useText(TEXT);
  return async (lines: readonly DraftLine[]): Promise<RecipeLineInput[] | string | undefined> => {
    const byName = new Map(ingredients.map((ingredient) => [ingredient.name.toLowerCase(), ingredient]));
    const resolved: RecipeLineInput[] = [];
    for (const line of lines.filter((one) => one.name.trim())) {
      const amount = Number(line.amount.replace(",", "."));
      if (!(amount > 0)) return text.amountRequired(line.name);
      let ingredientId = line.ingredientId ?? byName.get(line.name.trim().toLowerCase())?.id;
      if (!ingredientId) {
        const created = await run({ type: "ingredient.save", name: line.name, unit: line.unit, section: "", kcal: null, protein: null, carbs: null, fat: null, notes: "" });
        if (!created?.id) return undefined;
        ingredientId = created.id;
      }
      resolved.push({ ingredientId, amount, note: line.note });
    }
    return resolved;
  };
}
