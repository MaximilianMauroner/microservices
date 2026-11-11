import { formatNumber, ingredientGroups, isCountedUnit, unitName, type Ingredient } from "@tools-platform/service/kitchen-contract";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronRight, ListOrdered, Plus } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import type { OpenKitchen } from "../../state";
import { IngredientSheet } from "../ingredients/ingredient-sheet";
import { GroupsSheet } from "../ingredients/groups-sheet";
import { TEXT } from "../ingredients/text";
import { byGroup, Empty, groupLabel, type ListGroup, Press, Screen, SearchField, T, ToolbarButton, useKitText } from "../kit";
import { useLanguage, useText } from "../language";
import { groupColor, useColors } from "../theme";
import { compareText } from "../../compare";



type Editing = { kind: "ingredient"; id?: string; name: string } | { kind: "groups" } | null;

export function Ingredients({ data, top }: { data: OpenKitchen; top?: React.ReactNode }) {
  const { kitchen, change } = data;
  const language = useLanguage();
  const text = useText(TEXT);
  const kitText = useKitText();
  const colors = useColors();
  const [query, setQuery] = useState("");
  /** Search opens an ingredient by its id. */
  const asked = useLocalSearchParams<{ open?: string }>().open;
  const [editing, setEditing] = useState<Editing>(null);
  // Only a new id opens the sheet. A sync that changes the ingredients must not reopen a sheet the person closed.
  useEffect(() => {
    if (asked && kitchen.ingredients.some((one) => one.id === asked)) setEditing({ kind: "ingredient", id: asked, name: "" });
  }, [asked]);
  const typed = query.trim();
  const ingredients = [...kitchen.ingredients].sort((a, b) => compareText(a.name, b.name));
  const matches = ingredients.filter((one) => [one.name, ...ingredientGroups(one).map((group) => groupLabel(group, language))].join(" ").toLowerCase().includes(typed.toLowerCase()));
  const groups = byGroup(kitchen.kitchen.groups, matches.flatMap((ingredient) => ingredientGroups(ingredient).map((group) => ({ group, ingredient }))), (entry) => entry.group);
  const missing = ingredients.filter((one) => one.nutrition.kcal === null).length;
  const shared = ingredients.filter((one) => one.otherGroups.length > 0).length;
  const close = () => {
    setEditing(null);
    if (asked) router.setParams({ open: undefined });
  };
  const create = (name: string) => setEditing({ kind: "ingredient", name });

  return (
    <Screen title={kitText.tabs.kitchen[0]} top={top}
      facts={ingredients.length ? `${text.inKitchen(ingredients.length)}${shared ? text.inTwoGroups(shared) : ""}${missing ? text.withoutNutrition(missing) : ""}` : text.intro}
      toolbar={<>
        {ingredients.length ? <ToolbarButton tone="outline" icon={ListOrdered} label={text.arrangeGroups} onPress={() => setEditing({ kind: "groups" })} /> : null}
        <ToolbarButton icon={Plus} label={text.newIngredient} onPress={() => create("")} />
      </>}
      groups={groups.map(([section, entries]): ListGroup => ({
        key: section, label: groupLabel(section, language), color: groupColor(colors, kitchen.kitchen.groups, section), count: entries.length,
        rows: entries.map(({ ingredient }) => ({ key: ingredient.id, node: (
          <Press accessibilityRole="button" onPress={() => setEditing({ kind: "ingredient", id: ingredient.id, name: ingredient.name })}
            style={({ pressed }) => ({ minHeight: 64, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, paddingLeft: 16, paddingRight: 12, paddingVertical: 12, opacity: pressed ? 0.7 : 1 })}>
            <View style={{ flexGrow: 1, flexBasis: 150, gap: 3 }}>
              <T weight="medium">{ingredient.name}</T>
              <NutritionSummary ingredient={ingredient} />
            </View>
            {ingredient.recipeCount ? <T muted style={{ fontSize: 13 }}>{text.inRecipes(ingredient.recipeCount)}</T> : null}
            <ChevronRight size={18} color={colors.mutedForeground} />
          </Press>
        ) })),
      }))}>
      <SearchField value={query} onValue={setQuery} label={text.findPlaceholder} />
      {typed && !ingredients.some((one) => one.name.toLowerCase() === typed.toLowerCase()) ? (
        <Press accessibilityRole="button" onPress={() => create(typed)} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 }}>
          <Plus size={18} color={colors.pageInk.kitchen} />
          <T style={{ color: colors.pageInk.kitchen, flexShrink: 1 }}>{text.addNew(typed)}</T>
        </Press>
      ) : null}
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
  if (nutrition.kcal === null) return null;
  const per = isCountedUnit(ingredient.unit) ? text.perOne(unitName(ingredient.unit, language, 1)) : text.per100(ingredient.unit);
  return (
    <T muted style={{ fontSize: 12, fontVariant: ["tabular-nums"] }}>
      <T weight="semibold" style={{ fontSize: 12 }}>{formatNumber(nutrition.kcal, language)} {text.kcal}</T>
      {nutrition.protein !== null ? `, ${text.protein} ${formatNumber(nutrition.protein, language)} g` : ""}
      {nutrition.carbs !== null ? `, ${text.carbs} ${formatNumber(nutrition.carbs, language)} g` : ""}
      {nutrition.fat !== null ? `, ${text.fat} ${formatNumber(nutrition.fat, language)} g` : ""}
      {`, ${per}`}
    </T>
  );
}
