import { fieldNumber, UNSORTED_SECTION, unitName, type Ingredient, type IngredientUnit, type KitchenSnapshot } from "@tools-platform/service/kitchen-contract";
import { router } from "expo-router";
import { Plus, X } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { Button, Field, mainGroup, Press, SearchField, T } from "../kit";
import { useLanguage, useText } from "../language";
import { PickSheet } from "../pick-sheet";
import { recipeSummaries } from "../recipes/model";
import { RADIUS, useColors } from "../theme";
import { fieldValue, USUAL_AMOUNT } from "./model";
import { TEXT } from "./text";

/** Up to this many recipes show as one-tap chips. More go behind a full list to browse and select. */
const QUICK = 5;

export function RecipeUses({ existing, unit, uses, onUses, kitchen, onClose }: {
  existing?: Ingredient; unit: IngredientUnit; uses: ReadonlyMap<string, string>; onUses: (uses: ReadonlyMap<string, string>) => void; kitchen: KitchenSnapshot; onClose: () => void;
}) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const [query, setQuery] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const summaries = new Map(recipeSummaries(kitchen).map((one) => [one.id, one]));
  const recipes = kitchen.recipes.map((recipe) => ({ id: recipe.id, name: recipe.name, servings: recipe.servings, ingredientIds: recipe.lines.map((line) => line.ingredientId) }));
  const usedIn = existing ? recipes.filter((recipe) => recipe.ingredientIds.includes(existing.id)) : [];
  const open = recipes.filter((recipe) => !usedIn.includes(recipe) && !uses.has(recipe.id));
  const typed = query.trim().toLowerCase();
  const found = typed ? open.filter((recipe) => recipe.name.toLowerCase().includes(typed)) : open;
  const matches = found.slice(0, QUICK);
  const picked = [...uses].flatMap(([id, amount]) => {
    const recipe = recipes.find((one) => one.id === id);
    return recipe ? [{ recipe, amount }] : [];
  });
  const missing = picked.some(({ amount }) => {
    const value = fieldValue(amount);
    return value === null || !Number.isFinite(value) || value <= 0 || value > 1_000_000;
  });
  const usual = fieldNumber(USUAL_AMOUNT[unit], language);
  const pick = (id: string) => { onUses(new Map(uses).set(id, usual)); setQuery(""); };
  const pickMany = (ids: readonly string[]) => { onUses(new Map([...uses, ...ids.map((id) => [id, usual] as const)])); setQuery(""); };
  if (!recipes.length) return null;

  return (
    <View style={{ gap: 8, marginBottom: 12 }}>
      <T weight="medium">{text.recipes}</T>
      {usedIn.length ? <View accessibilityLabel={text.recipesUsingIt} style={{ gap: 6 }}>
        <T muted style={{ fontSize: 12 }}>{text.alreadyIn}</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {usedIn.map((recipe) => (
            <Press key={recipe.id} accessibilityRole="link" onPress={() => { onClose(); router.push({ pathname: "/kitchen/[recipeId]", params: { recipeId: recipe.id } }); }}
              style={{ minHeight: 48, justifyContent: "center", maxWidth: "100%", paddingHorizontal: 12, borderWidth: 1, borderColor: colors.controlBorder, borderRadius: 22, backgroundColor: colors.control }}>
              <T style={{ fontSize: 14 }}>{recipe.name}</T>
            </Press>
          ))}
        </View>
      </View> : null}
      {picked.length ? <View accessibilityLabel={text.addingTo} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS, overflow: "hidden" }}>
        {picked.map(({ recipe, amount }, index) => (
          <View key={recipe.id} style={{ gap: 8, padding: 12, borderTopWidth: index ? 1 : 0, borderTopColor: colors.border }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <T weight="medium">{recipe.name}</T>
                <T muted style={{ fontSize: 12 }}>{text.forServings(recipe.servings)}</T>
              </View>
              <Button tone="ghost" icon={X} accessibilityLabel={text.removeRecipe(recipe.name)} onPress={() => { const next = new Map(uses); next.delete(recipe.id); onUses(next); }} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Field accessibilityLabel={text.amountFor(recipe.name)} value={amount} inputMode="decimal" placeholder="–"
                onChangeText={(value) => onUses(new Map(uses).set(recipe.id, value))} style={{ flex: 1, fontVariant: ["tabular-nums"] }} />
              <T muted>{unitName(unit, language)}</T>
            </View>
          </View>
        ))}
      </View> : null}
      {missing ? <T muted style={{ fontSize: 12 }}>{text.amountsNeeded}</T> : null}
      {open.length ? <View style={{ gap: 6 }}>
        <SearchField value={query} onValue={setQuery} label={usedIn.length || picked.length ? text.findAnotherRecipe : text.findRecipe} />
        {matches.length ? <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {matches.map((recipe) => (
              <Press key={recipe.id} accessibilityRole="button" accessibilityLabel={text.addToRecipe(recipe.name)} onPress={() => pick(recipe.id)}
                style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 48, maxWidth: "100%", paddingHorizontal: 12, borderWidth: 1, borderColor: colors.controlBorder, backgroundColor: colors.control, borderRadius: 22 }}>
                <Plus size={16} color={colors.mutedForeground} />
                <T style={{ flexShrink: 1, fontSize: 14 }}>{recipe.name}</T>
              </Press>
            ))}
          </View>
          {found.length > QUICK ? <View style={{ flexDirection: "row" }}>
            <Button tone="outline" label={typed ? text.showAllMatches(found.length) : text.showAllRecipes(found.length)} onPress={() => setBrowsing(true)} />
          </View> : null}
          {picked.length ? null : <T muted style={{ fontSize: 12 }}>{text.quickAdd}</T>}
        </> : <T muted style={{ fontSize: 12 }}>{text.noRecipeMatch(query.trim())}</T>}
      </View> : null}
      {browsing ? <PickSheet title={text.pickRecipes} query={query} groups={kitchen.kitchen.groups} confirm={text.addToRecipes} onPick={pickMany} onClose={() => setBrowsing(false)}
        items={open.map((recipe) => ({ id: recipe.id, label: recipe.name, detail: text.forServings(recipe.servings), group: mainGroup(kitchen.kitchen.groups, summaries.get(recipe.id)?.sections ?? []) ?? UNSORTED_SECTION }))} /> : null}
    </View>
  );
}
