import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { Carrot, Clock, Plus, Refrigerator, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { OpenKitchen } from "../../state";
import { Button, Empty, Field, FloatingButton, mainGroup, PlateRing, Pane, Press, Screen, SearchField, Snackbar, T, useKitText, type Notice, usePageColor } from "../kit";
import { haptic } from "../haptics";
import { type KitchenLanguage, useText } from "../language";
import { filterRecipes, recipeSummaries } from "../recipes/model";
import { groupColor, tint, useColors } from "../theme";
import { RecipePageContent } from "./recipe-page";
import { useContentLayout, Workspace } from "../responsive";
import { RecipeMenu } from "../week/sheets";

const en = {
  title: "Recipes",
  selectRecipe: "Select a recipe to see its ingredients and steps.",
  recipes: (count: number) => count === 1 ? "1 recipe" : `${count} recipes`,
  stillIdeas: (count: number) => count === 1 ? ", 1 still an idea without ingredients" : `, ${count} still ideas without ingredients`,
  intro: "Collect the dishes you cook. A name is enough to start.",
  newRecipe: "New recipe",
  findRecipe: "Search recipes",
  fromHome: "Ready to cook",
  withIngredient: "By ingredient",
  removeFilter: (name: string) => `Remove ${name}`,
  allAtHome: "All at home",
  missing: (names: readonly string[]) => `${names.length} missing: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""}`,
  noFit: "No recipe fits these filters",
  removeAFilter: "Remove a filter to see more.",
  addIdea: (name: string) => `Add “${name}” as an idea`,
  idea: "Idea. Add ingredients when you cook it.",
  kcal: "kcal",
  protein: "Protein",
  minutes: (count: number) => `${count} min`,
  noMatch: (query: string) => `No recipe matches “${query}”`,
  noRecipes: "No recipes yet",
  tryAnother: "Try another word, or select + to keep it as an idea.",
  recipeActions: "Recipe actions",
  addIdeaHint: "Select “New recipe” to write one down. Or type a name in the search and select the + to keep it as an idea for later."
};
const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: {
    title: "Rezepte",
    selectRecipe: "Wähle ein Rezept für Zutaten und Zubereitung.",
    recipes: (count: number) => count === 1 ? "1 Rezept" : `${count} Rezepte`,
    stillIdeas: (count: number) => count === 1 ? ", 1 noch eine Idee ohne Zutaten" : `, ${count} noch Ideen ohne Zutaten`,
    intro: "Sammle die Gerichte, die du kochst. Ein Name reicht zum Start.",
    newRecipe: "Neues Rezept",
    findRecipe: "Rezepte suchen",
    fromHome: "Kochbereit",
    withIngredient: "Nach Zutat",
    removeFilter: (name: string) => `${name} entfernen`,
    allAtHome: "Alles im Vorrat",
    missing: (names: readonly string[]) => `${names.length} ${names.length === 1 ? "fehlt" : "fehlen"}: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""}`,
    noFit: "Kein Rezept passt zu diesen Filtern",
    removeAFilter: "Entferne einen Filter, um mehr zu sehen.",
    addIdea: (name: string) => `„${name}“ als Idee hinzufügen`,
    idea: "Idee. Füge Zutaten hinzu, wenn du es kochst.",
    kcal: "kcal",
    protein: "Eiweiß",
    minutes: (count: number) => `${count} Min.`,
    noMatch: (query: string) => `Kein Rezept passt zu „${query}“`,
    noRecipes: "Noch keine Rezepte",
    tryAnother: "Probier ein anderes Wort, oder tippe auf +, um es als Idee zu behalten.",
    recipeActions: "Rezeptaktionen",
    addIdeaHint: "Mit „Neues Rezept“ schreibst du eins auf. Oder tippe einen Namen in die Suche und behalte ihn mit dem + als Idee für später."
  }
};



export function Recipes({ data, top, initialRecipeId }: { data: OpenKitchen; top?: React.ReactNode; initialRecipeId?: string }) {
  const { kitchen, change } = data;
  const wide = useContentLayout().panes > 1;
  const [selectedRecipeId, setSelectedRecipeId] = useState(initialRecipeId);
  const closeRecipe = () => { if (initialRecipeId) router.back(); else setSelectedRecipeId(undefined); };
  const select = (id: string) => {
    if (wide || initialRecipeId) setSelectedRecipeId(id);
    else router.push({ pathname: "/kitchen/[recipeId]", params: { recipeId: id } });
  };
  const text = useText(TEXT);
  const kitText = useKitText();
  const colors = useColors();
  const { hue } = usePageColor();
  const [query, setQuery] = useState("");
  const [fromHome, setFromHome] = useState(false);
  const [wanted, setWanted] = useState<string[]>([]);
  const [pick, setPick] = useState("");
  const [picking, setPicking] = useState(false);
  const [held, setHeld] = useState<string>();
  const [notice, setNotice] = useState<Notice | null>(null);
  const menuRecipe = kitchen.recipes.find((one) => one.id === held);
  const hold = (id: string) => { haptic("hold"); setHeld(id); };
  const recipes = useMemo(() => recipeSummaries(kitchen), [kitchen]);
  const selected = kitchen.ingredients.filter((one) => wanted.includes(one.id));
  const matches = filterRecipes(recipes, query, selected.map((one) => one.id), fromHome);
  const ideas = recipes.filter((recipe) => !recipe.ingredientCount).length;
  const filtered = fromHome || selected.length > 0;
  const idea = query.trim().replace(/\s+/g, " ");
  const isNew = idea.length > 0 && idea.length <= 120 && !recipes.some((recipe) => recipe.name.toLowerCase() === idea.toLowerCase());
  const choices = pick.trim() ? kitchen.ingredients.filter((one) => !wanted.includes(one.id) && one.name.toLowerCase().includes(pick.trim().toLowerCase())) : [];
  function addWanted(id: string) {
    setWanted((current) => current.includes(id) ? current : [...current, id]);
    setPick("");
    setPicking(false);
  }

  const detail = selectedRecipeId ? <RecipePageContent key={selectedRecipeId} data={data} recipeId={selectedRecipeId} onClose={closeRecipe} onSelect={setSelectedRecipeId} />
    : wide ? <Pane title={kitText.tabs.kitchen[0]} onClose={closeRecipe}><T muted>{text.selectRecipe}</T></Pane> : null;
  return (
    <Workspace detail={detail} replace selected={Boolean(selectedRecipeId)}>
      <Screen title={text.title} top={top} facts={recipes.length ? `${text.recipes(recipes.length)}${ideas ? text.stillIdeas(ideas) : ""}` : text.intro}
        fab={<FloatingButton icon={Plus} label={text.newRecipe} onPress={() => select("new")} />}
        floating={<Snackbar notice={notice} onUndo={change} onDone={() => setNotice(null)} />}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <View style={{ flex: 1 }}><SearchField value={query} onValue={setQuery} label={text.findRecipe} /></View>
          {isNew ? <Button icon={Plus} accessibilityLabel={text.addIdea(idea)} onPress={() => change({ type: "recipe.save", createId: Crypto.randomUUID(), name: idea, servings: 2, minutes: null, instructions: "", lines: [] })} /> : null}
        </View>
        {recipes.length ? (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Press accessibilityRole="button" accessibilityState={{ selected: fromHome }} onPress={() => setFromHome((value) => !value)}
                style={[styles.filter, { borderColor: fromHome ? hue : colors.controlBorder, backgroundColor: fromHome ? hue : colors.control }]}>
                <Refrigerator size={16} color={fromHome ? "#ffffff" : colors.mutedForeground} />
                <T weight="medium" textBreakStrategy="simple" style={{ fontSize: 14, flexShrink: 1, color: fromHome ? "#ffffff" : colors.foreground }}>{text.fromHome}</T>
              </Press>
              {picking ? null : (
                <Press accessibilityRole="button" onPress={() => setPicking(true)} style={[styles.filter, { borderColor: colors.controlBorder, backgroundColor: colors.control }]}>
                  <Carrot size={16} color={colors.mutedForeground} />
                  <T weight="medium" textBreakStrategy="simple" style={{ fontSize: 14, flexShrink: 1, color: colors.foreground }}>{text.withIngredient}</T>
                </Press>
              )}
            </View>
            {selected.length ? <View style={styles.wrap}>
              {selected.map((one) => (
                <View key={one.id} style={[styles.filter, { paddingRight: 0, borderColor: hue, backgroundColor: tint(hue, 12, colors.background) }]}>
                  <T style={{ fontSize: 14, flexShrink: 1 }}>{one.name}</T>
                  <Button tone="ghost" compact icon={X} accessibilityLabel={text.removeFilter(one.name)} onPress={() => setWanted((current) => current.filter((id) => id !== one.id))} />
                </View>
              ))}
            </View> : null}
            {picking ? <Field autoFocus value={pick} placeholder={text.withIngredient} accessibilityLabel={text.withIngredient}
              onBlur={() => { if (!pick.trim()) setPicking(false); }}
              onChangeText={(value) => {
                setPick(value);
                const found = kitchen.ingredients.find((one) => one.name.toLowerCase() === value.trim().toLowerCase());
                if (found) addWanted(found.id);
              }}
              onSubmitEditing={() => {
                const found = kitchen.ingredients.find((one) => one.name.toLowerCase() === pick.trim().toLowerCase());
                if (found) addWanted(found.id);
              }} /> : null}
            {choices.length ? <View style={styles.wrap}>{choices.map((one) => <Button key={one.id} tone="outline" label={one.name} onPress={() => addWanted(one.id)} />)}</View> : null}
          </View>
        ) : null}
        {matches.length ? <View style={{ gap: 8 }}>{matches.map((recipe) => {
          const group = mainGroup(kitchen.kitchen.groups, recipe.sections);
          return (
            <Press key={recipe.id} accessibilityRole="button" onPress={() => select(recipe.id)}
              onLongPress={() => hold(recipe.id)} accessibilityActions={[{ name: "longpress", label: text.recipeActions }]}
              onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === "longpress") setHeld(recipe.id); }} style={({ pressed }) => [styles.recipe, { backgroundColor: group ? tint(groupColor(colors, kitchen.kitchen.groups, group), 11, colors.card) : colors.muted, opacity: pressed ? 0.8 : 1 }]}>
                <PlateRing groups={kitchen.kitchen.groups} sections={recipe.sections} size={36} />
                <View style={{ flex: 1, gap: 6 }}>
                  <T weight="semibold" style={{ fontSize: 18, lineHeight: 23 }}>{recipe.name}</T>
                  {recipe.ingredientCount ? <View style={styles.wrap}>
                    {recipe.kcal !== null ? <T muted style={styles.small}><T weight="semibold" style={styles.small}>{recipe.kcal}</T> {text.kcal}</T> : null}
                    {recipe.protein !== null ? <T muted style={styles.small}><T weight="semibold" style={styles.small}>{recipe.protein} g</T> {text.protein}</T> : null}
                    {recipe.minutes ? <View style={styles.inline}><Clock size={12} color={colors.mutedForeground} /><T muted style={styles.small}>{text.minutes(recipe.minutes)}</T></View> : null}
                  </View> : <T muted style={styles.small}>{text.idea}</T>}
                  {recipe.ingredientCount ? recipe.missing.length
                    ? fromHome ? <T muted style={styles.small}>{text.missing(recipe.missing)}</T> : null
                    : <View style={styles.inline}><Refrigerator size={14} color={colors.pageInk.kitchen} /><T weight="medium" style={[styles.small, { color: colors.pageInk.kitchen }]}>{text.allAtHome}</T></View>
                    : null}
                </View>
            </Press>
          );
        })}</View> : <Empty title={!recipes.length ? text.noRecipes : filtered ? text.noFit : text.noMatch(query)} body={!recipes.length ? text.addIdeaHint : filtered ? text.removeAFilter : text.tryAnother} />}
        {menuRecipe ? <RecipeMenu key={menuRecipe.id} recipe={menuRecipe} data={data} onClose={() => setHeld(undefined)} notify={setNotice} /> : null}
      </Screen>
    </Workspace>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  filter: { minHeight: 48, maxWidth: "100%", borderRadius: 22, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12 },
  recipe: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16, borderRadius: 16 },
  small: { fontSize: 12 },
  inline: { flexDirection: "row", alignItems: "center", gap: 4 }
});
