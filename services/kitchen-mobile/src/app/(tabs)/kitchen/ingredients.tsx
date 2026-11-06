import { formatNumber, ingredientGroups, isCountedUnit, unitName, type Ingredient } from "@tools-platform/service/kitchen-contract";
import { router } from "expo-router";
import { ChevronLeft, ListOrdered, Plus } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import type { OpenKitchen } from "../../../state";
import { IngredientSheet } from "../../../ui/ingredients/ingredient-sheet";
import { GroupsSheet } from "../../../ui/ingredients/groups-sheet";
import { TEXT } from "../../../ui/ingredients/text";
import { TEXT as KITCHEN_TEXT } from "../../../ui/kitchen/text";
import { KitchenScreen } from "../../../ui/page";
import { byGroup, Button, Empty, GroupLabel, GroupList, groupLabel, Screen, SearchField, T } from "../../../ui/kit";
import { useLanguage, useText } from "../../../ui/language";
import { groupColor, useColors } from "../../../ui/theme";

export default function IngredientsPage() {
  return <KitchenScreen page="kitchen">{(open) => <Ingredients key={open.kitchen.kitchen.id} {...open} />}</KitchenScreen>;
}

type Editing = { kind: "ingredient"; id?: string; name: string } | { kind: "groups" } | null;

function Ingredients({ kitchen, change }: OpenKitchen) {
  const language = useLanguage();
  const text = useText(TEXT);
  const kitchenText = useText(KITCHEN_TEXT);
  const colors = useColors();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const typed = query.trim();
  const ingredients = [...kitchen.ingredients].sort((a, b) => a.name.localeCompare(b.name));
  const matches = ingredients.filter((one) => [one.name, ...ingredientGroups(one).map((group) => groupLabel(group, language))].join(" ").toLowerCase().includes(typed.toLowerCase()));
  const groups = byGroup(kitchen.kitchen.groups, matches.flatMap((ingredient) => ingredientGroups(ingredient).map((group) => ({ group, ingredient }))), (entry) => entry.group);
  const missing = ingredients.filter((one) => one.nutrition.kcal === null).length;
  const shared = ingredients.filter((one) => one.otherGroups.length > 0).length;
  const close = () => setEditing(null);
  const create = (name: string) => setEditing({ kind: "ingredient", name });

  return (
    <Screen title={text.title}
      facts={ingredients.length ? `${text.inKitchen(ingredients.length)}${shared ? text.inTwoGroups(shared) : ""}${missing ? text.withoutNutrition(missing) : ""}` : text.intro}
      actions={<>
        {ingredients.length ? <Button tone="outline" icon={ListOrdered} label={text.arrangeGroups} onPress={() => setEditing({ kind: "groups" })} /> : null}
        <Button icon={Plus} label={text.newIngredient} onPress={() => create("")} />
      </>}>
      <View style={{ alignSelf: "flex-start" }}><Button tone="ghost" icon={ChevronLeft} label={kitchenText.title} onPress={() => router.navigate("/kitchen")} /></View>
      <SearchField value={query} onValue={setQuery} label={text.findPlaceholder} />
      {typed && !ingredients.some((one) => one.name.toLowerCase() === typed.toLowerCase()) ? (
        <Pressable accessibilityRole="button" onPress={() => create(typed)} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 }}>
          <Plus size={18} color={colors.pageInk.kitchen} />
          <T style={{ color: colors.pageInk.kitchen, flexShrink: 1 }}>{text.addNew(typed)}</T>
        </Pressable>
      ) : null}
      {groups.map(([section, entries]) => {
        const color = groupColor(colors, kitchen.kitchen.groups, section);
        return (
          <View key={section} accessibilityLabel={groupLabel(section, language)}>
            <GroupLabel color={color} count={entries.length}>{groupLabel(section, language)}</GroupLabel>
            <GroupList color={color}>
              {entries.map(({ ingredient }) => (
                <Pressable key={ingredient.id} accessibilityRole="button" onPress={() => setEditing({ kind: "ingredient", id: ingredient.id, name: ingredient.name })}
                  style={({ pressed }) => ({ minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, opacity: pressed ? 0.7 : 1 })}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <T weight="medium">{ingredient.name}</T>
                    <NutritionSummary ingredient={ingredient} />
                  </View>
                  <View style={{ maxWidth: "35%", gap: 3 }}>
                    <T muted style={{ fontSize: 12, textAlign: "right" }}>{isCountedUnit(ingredient.unit) ? text.perOne(unitName(ingredient.unit, language, 1)) : text.per100(ingredient.unit)}</T>
                    {ingredient.recipeCount ? <T muted style={{ fontSize: 12, textAlign: "right" }}>{text.inRecipes(ingredient.recipeCount)}</T> : null}
                  </View>
                </Pressable>
              ))}
            </GroupList>
          </View>
        );
      })}
      {!matches.length ? <Empty title={ingredients.length ? text.noMatch(query) : text.noIngredients} body={ingredients.length ? text.tryAnother : text.addHere} /> : null}
      {editing?.kind === "groups" ? <GroupsSheet kitchen={kitchen} change={change} onClose={close} /> : null}
      {editing?.kind === "ingredient" ? <IngredientSheet kitchen={kitchen} change={change} existing={ingredients.find((one) => one.id === editing.id)} newName={editing.name} onClose={close} /> : null}
    </Screen>
  );
}

function NutritionSummary({ ingredient }: { ingredient: Ingredient }) {
  const text = useText(TEXT);
  const language = useLanguage();
  const { nutrition } = ingredient;
  if (nutrition.kcal === null) return <T muted style={{ fontSize: 12 }}>{text.noNutrition}</T>;
  return (
    <T muted style={{ fontSize: 12, fontVariant: ["tabular-nums"] }}>
      <T weight="semibold" style={{ fontSize: 12 }}>{formatNumber(nutrition.kcal, language)} {text.kcal}</T>
      {nutrition.protein !== null ? `, ${text.protein} ${formatNumber(nutrition.protein, language)} g` : ""}
      {nutrition.carbs !== null ? `, ${text.carbs} ${formatNumber(nutrition.carbs, language)} g` : ""}
      {nutrition.fat !== null ? `, ${text.fat} ${formatNumber(nutrition.fat, language)} g` : ""}
    </T>
  );
}
