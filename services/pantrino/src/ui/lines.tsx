import { fieldNumber, type Ingredient, INGREDIENT_UNITS, type IngredientUnit, type RecipeLine, type RecipeLineInput, unitName } from "@tools-platform/service/kitchen-contract";
import * as Crypto from "expo-crypto";
import { ListChecks, Plus, X } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import type { QueuedAction } from "../sync/model";
import { Button, Field, Press, T } from "./kit";
import { type KitchenLanguage, useLanguage, useText } from "./language";
import { PickSheet } from "./pick-sheet";
import { useColors } from "./theme";

const en = {
  amountPlaceholder: "e.g. 200",
  ingredient: "Ingredient",
  ingredientNumber: (position: number) => `Ingredient ${position}`,
  amountOf: (name: string) => `Amount of ${name}`,
  unitOf: (name: string) => `Unit of ${name}`,
  noteOn: (name: string) => `Note on ${name}`,
  removeItem: (name: string) => name ? `Remove ${name}` : "Remove ingredient",
  notePlaceholder: "Note, e.g. diced",
  addIngredient: "Add ingredient",
  chooseIngredients: "Choose from list",
  pickTitle: "Choose ingredients",
  addPicked: (count: number) => count === 1 ? "Add 1 ingredient" : count ? `Add ${count} ingredients` : "Add",
  amountRequired: (name: string) => `Enter an amount for ${name}.`
};

const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: {
    amountPlaceholder: "z. B. 200",
    ingredient: "Zutat",
    ingredientNumber: (position: number) => `Zutat ${position}`,
    amountOf: (name: string) => `Menge von ${name}`,
    unitOf: (name: string) => `Einheit von ${name}`,
    noteOn: (name: string) => `Notiz zu ${name}`,
    removeItem: (name: string) => name ? `${name} entfernen` : "Zutat entfernen",
    notePlaceholder: "Notiz, z. B. gewürfelt",
    addIngredient: "Zutat hinzufügen",
    chooseIngredients: "Aus Liste wählen",
    pickTitle: "Zutaten wählen",
    addPicked: (count: number) => count === 1 ? "1 Zutat hinzufügen" : count ? `${count} Zutaten hinzufügen` : "Hinzufügen",
    amountRequired: (name: string) => `Gib eine Menge für ${name} ein.`
  }
};

/** One ingredient line while a person edits it. A new name has no ingredient yet. */
export type DraftLine = { key: string; ingredientId?: string; name: string; unit: IngredientUnit; amount: string; note: string };

export function draftLines(lines: readonly RecipeLine[], language: KitchenLanguage): DraftLine[] {
  return lines.map((line) => ({ key: line.ingredientId, ingredientId: line.ingredientId, name: line.ingredient, unit: line.unit, amount: fieldNumber(line.amount, language), note: line.note }));
}

/**
 * Edits a list of ingredient lines, for a recipe or for one planned meal. A typed name suggests known ingredients below the field.
 * "Choose from list" shows every known ingredient by group, so a person can browse for ideas and add many at once.
 */
export function LineEditor({ lines, onLines, ingredients, groups }: { lines: readonly DraftLine[]; onLines: (update: (current: DraftLine[]) => DraftLine[]) => void; ingredients: readonly Ingredient[]; groups: readonly string[] }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const [choosing, setChoosing] = useState(false);
  const taken = new Set(lines.flatMap((line) => [line.ingredientId ?? "", line.name.trim().toLowerCase()]));
  const choices = ingredients.filter((one) => !taken.has(one.id) && !taken.has(one.name.toLowerCase()));
  const byName = new Map(ingredients.map((ingredient) => [ingredient.name.toLowerCase(), ingredient]));
  const update = (key: string, patch: Partial<DraftLine>) => onLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  return (
    <View style={{ gap: 8 }}>
      {lines.map((line, index) => {
        const known = line.ingredientId ? ingredients.find((one) => one.id === line.ingredientId) : byName.get(line.name.trim().toLowerCase());
        const called = line.name.trim() || text.ingredientNumber(index + 1);
        const typed = line.name.trim().toLowerCase();
        const suggestions = typed && !known ? ingredients.filter((one) => one.name.toLowerCase().includes(typed)).slice(0, 5) : [];
        return (
          <View key={line.key} style={{ gap: 8, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Field style={{ flex: 1 }} accessibilityLabel={text.ingredientNumber(index + 1)} value={line.name} placeholder={text.ingredient}
                onChangeText={(value) => {
                  const match = byName.get(value.trim().toLowerCase());
                  update(line.key, { name: value, ingredientId: match?.id, unit: match?.unit ?? line.unit });
                }} />
              <Button tone="ghost" compact icon={X} accessibilityLabel={text.removeItem(line.name)} onPress={() => onLines((current) => current.filter((one) => one.key !== line.key))} />
            </View>
            {suggestions.length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {suggestions.map((one) => (
                  <Press key={one.id} accessibilityRole="button" hitSlop={8} onPress={() => update(line.key, { name: one.name, ingredientId: one.id, unit: one.unit })}
                    style={{ paddingHorizontal: 10, height: 32, justifyContent: "center", borderRadius: 16, backgroundColor: colors.muted }}>
                    <T style={{ fontSize: 14 }}>{one.name}</T>
                  </Press>
                ))}
              </View>
            ) : null}
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Field style={{ width: 110 }} accessibilityLabel={text.amountOf(called)} keyboardType="decimal-pad" value={line.amount} placeholder={text.amountPlaceholder} onChangeText={(value) => update(line.key, { amount: value })} />
              {known ? <T muted>{unitName(known.unit, language, Number(line.amount.replace(",", ".")))}</T> : (
                <View accessibilityLabel={text.unitOf(called)} style={{ flexDirection: "row", gap: 4 }}>
                  {INGREDIENT_UNITS.map((unit) => (
                    <Press key={unit} accessibilityRole="button" accessibilityState={{ selected: unit === line.unit }} hitSlop={8} onPress={() => update(line.key, { unit })}
                      style={{ height: 32, paddingHorizontal: 8, justifyContent: "center", borderRadius: 8, borderWidth: 1, borderColor: unit === line.unit ? colors.foreground : colors.controlBorder }}>
                      <T style={{ fontSize: 13 }}>{unitName(unit, language)}</T>
                    </Press>
                  ))}
                </View>
              )}
            </View>
            <Field accessibilityLabel={text.noteOn(called)} value={line.note} placeholder={text.notePlaceholder} onChangeText={(value) => update(line.key, { note: value })} />
          </View>
        );
      })}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button tone="outline" icon={Plus} label={text.addIngredient} onPress={() => onLines((current) => [...current, { key: Crypto.randomUUID(), name: "", unit: "g", amount: "", note: "" }])} />
        {choices.length ? <Button tone="outline" icon={ListChecks} label={text.chooseIngredients} onPress={() => setChoosing(true)} /> : null}
      </View>
      {choosing ? <PickSheet title={text.pickTitle} groups={groups} confirm={text.addPicked} onClose={() => setChoosing(false)}
        items={choices.map((one) => ({ id: one.id, label: one.name, detail: unitName(one.unit, language), group: one.section }))}
        onPick={(ids) => {
          const chosen = ids.flatMap((id) => choices.filter((one) => one.id === id));
          onLines((current) => [
            ...current.filter((line) => line.name.trim() || line.amount.trim() || line.note.trim()),
            ...chosen.map((one) => ({ key: Crypto.randomUUID(), ingredientId: one.id, name: one.name, unit: one.unit, amount: "", note: "" })),
          ]);
        }} /> : null}
    </View>
  );
}

/**
 * Turns drafts into saved lines. A new name becomes a new ingredient first: its change is queued before the
 * change that uses it, with an ID chosen here, so both work offline. Returns an error text when an amount is missing.
 */
export function useResolveLines() {
  const text = useText(TEXT);
  return (lines: readonly DraftLine[], ingredients: readonly Ingredient[], change: (action: QueuedAction) => void): RecipeLineInput[] | string => {
    const byName = new Map(ingredients.map((ingredient) => [ingredient.name.toLowerCase(), ingredient]));
    const filled = lines.filter((one) => one.name.trim());
    const missing = filled.find((line) => !(Number(line.amount.replace(",", ".")) > 0));
    if (missing) return text.amountRequired(missing.name);
    const created = new Map<string, string>();
    return filled.map((line) => {
      const name = line.name.trim();
      let ingredientId = line.ingredientId ?? byName.get(name.toLowerCase())?.id ?? created.get(name.toLowerCase());
      if (!ingredientId) {
        ingredientId = Crypto.randomUUID();
        created.set(name.toLowerCase(), ingredientId);
        change({ type: "ingredient.save", createId: ingredientId, name, unit: line.unit, section: "", kcal: null, protein: null, carbs: null, fat: null, notes: "" });
      }
      return { ingredientId, amount: Number(line.amount.replace(",", ".")), note: line.note };
    });
  };
}
