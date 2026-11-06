import { fieldNumber, unitName, type Ingredient, type IngredientUnit, type KitchenSnapshot } from "@tools-platform/service/kitchen-contract";
import { router } from "expo-router";
import { Plus, X } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Button, Field, SearchField, T } from "../kit";
import { useLanguage, useText } from "../language";
import { RADIUS, useColors } from "../theme";
import { fieldValue, USUAL_AMOUNT } from "./model";
import { TEXT } from "./text";

export function RecipeUses({ existing, unit, uses, onUses, kitchen, onClose }: {
  existing?: Ingredient; unit: IngredientUnit; uses: ReadonlyMap<string, string>; onUses: (uses: ReadonlyMap<string, string>) => void; kitchen: KitchenSnapshot; onClose: () => void;
}) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const [query, setQuery] = useState("");
  const recipes = kitchen.recipes.map((recipe) => ({ id: recipe.id, name: recipe.name, servings: recipe.servings, ingredientIds: recipe.lines.map((line) => line.ingredientId) }));
  const usedIn = existing ? recipes.filter((recipe) => recipe.ingredientIds.includes(existing.id)) : [];
  const open = recipes.filter((recipe) => !usedIn.includes(recipe) && !uses.has(recipe.id));
  const typed = query.trim().toLowerCase();
  const matches = (typed ? open.filter((recipe) => recipe.name.toLowerCase().includes(typed)) : open).slice(0, 8);
  const picked = [...uses].flatMap(([id, amount]) => {
    const recipe = recipes.find((one) => one.id === id);
    return recipe ? [{ recipe, amount }] : [];
  });
  const missing = picked.some(({ amount }) => {
    const value = fieldValue(amount);
    return value === null || !Number.isFinite(value) || value <= 0 || value > 1_000_000;
  });
  const pick = (id: string) => { onUses(new Map(uses).set(id, fieldNumber(USUAL_AMOUNT[unit], language))); setQuery(""); };
  if (!recipes.length) return null;

  return (
    <View style={{ gap: 8, marginBottom: 12 }}>
      <T weight="medium">{text.recipes}</T>
      {usedIn.length ? <View accessibilityLabel={text.recipesUsingIt} style={{ gap: 6 }}>
        <T muted style={{ fontSize: 12 }}>{text.alreadyIn}</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {usedIn.map((recipe) => (
            <Pressable key={recipe.id} accessibilityRole="link" onPress={() => { onClose(); router.push({ pathname: "/recipes/[recipeId]", params: { recipeId: recipe.id } }); }}
              style={{ minHeight: 48, justifyContent: "center", maxWidth: "100%", paddingHorizontal: 12, borderWidth: 1, borderColor: colors.controlBorder, borderRadius: 22, backgroundColor: colors.control }}>
              <T style={{ fontSize: 14 }}>{recipe.name}</T>
            </Pressable>
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
              <Pressable key={recipe.id} accessibilityRole="button" accessibilityLabel={text.addToRecipe(recipe.name)} onPress={() => pick(recipe.id)}
                style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 48, maxWidth: "100%", paddingHorizontal: 12, borderWidth: 1, borderColor: colors.controlBorder, backgroundColor: colors.control, borderRadius: 22 }}>
                <Plus size={16} color={colors.mutedForeground} />
                <T style={{ flexShrink: 1, fontSize: 14 }}>{recipe.name}</T>
              </Pressable>
            ))}
          </View>
          {picked.length ? null : <T muted style={{ fontSize: 12 }}>{text.quickAdd}</T>}
        </> : <T muted style={{ fontSize: 12 }}>{text.noRecipeMatch(query.trim())}</T>}
      </View> : null}
    </View>
  );
}
