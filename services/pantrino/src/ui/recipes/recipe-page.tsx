import { formatAmount, nutritionPerServing, scaledLines, type Recipe } from "@tools-platform/service/kitchen-contract";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { CalendarPlus, Pencil, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { OpenKitchen } from "../../state";
import { Button, byGroup, Empty, Field, GroupDot, type Notice, Screen, Sheet, Snackbar, Stepper, T, ToolbarButton } from "../kit";
import { type KitchenLanguage, useLanguage, useText } from "../language";
import { type DraftLine, draftLines, LineEditor, useResolveLines } from "../lines";
import { useColors } from "../theme";
import { RecipeMenu } from "../week/sheets";
import { recipeDraftError } from "./model";
import { useContentLayout } from "../responsive";

const en = {
  namePlaceholder: "e.g. lentil and chickpea curry",
  minutesPlaceholder: "e.g. 30",
  newRecipe: "New recipe",
  kcal: "kcal",
  protein: "Protein",
  carbs: "Carbs",
  fat: "Fat",
  minutes: (count: number) => `${count} min`,
  servings: (count: number) => count === 1 ? "1 serving" : `${count} servings`,
  servingsLabel: "Servings",
  allRecipes: "All recipes",
  edit: "Edit",
  plan: "Plan",
  ingredients: "Ingredients",
  perServing: "per serving",
  addNutrition: "Add nutrition to every ingredient to see values per serving.",
  noIngredients: "No ingredients yet. Edit the recipe to add them, so the shopping list can count them.",
  steps: "Steps",
  noSteps: "No steps written down yet.",
  deleteConfirm: (name: string) => `Delete ${name}? It also leaves the week plan.`,
  deleteRecipe: "Delete recipe",
  cancel: "Cancel",
  saveRecipe: "Save recipe",
  editTitle: (name: string) => `Edit ${name}`,
  amountsHint: "Amounts are for the number of servings you set.",
  name: "Name",
  minutesLabel: "Minutes",
  newNames: "New names become new ingredients",
  stepsPlaceholder: "One step per line.\nDice the onions.\nFry them in olive oil.",
  nameRequired: "Give the recipe a name.",
  nameTooLong: "Use 120 characters or fewer for the recipe name.",
  nameInUse: "A recipe already has this name.",
  minutesInvalid: "Minutes must be a whole number from 1 to 10000.",
  duplicateIngredient: "Each ingredient can appear once. Combine the amounts.",
  amountInvalid: "Each amount must be more than 0 and at most 1000000.",
  missingRecipe: "This recipe is no longer in this kitchen."
};
const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: {
    namePlaceholder: "z. B. Linsen-Kichererbsen-Curry",
    minutesPlaceholder: "z. B. 30",
    newRecipe: "Neues Rezept",
    kcal: "kcal",
    protein: "Eiweiß",
    carbs: "Kohlenhydrate",
    fat: "Fett",
    minutes: (count: number) => `${count} Min.`,
    servings: (count: number) => count === 1 ? "1 Portion" : `${count} Portionen`,
    servingsLabel: "Portionen",
    allRecipes: "Alle Rezepte",
    edit: "Bearbeiten",
    plan: "Planen",
    ingredients: "Zutaten",
    perServing: "pro Portion",
    addNutrition: "Füge jeder Zutat Nährwerte hinzu, um die Werte pro Portion zu sehen.",
    noIngredients: "Noch keine Zutaten. Bearbeite das Rezept, damit die Einkaufsliste sie zählen kann.",
    steps: "Zubereitung",
    noSteps: "Noch keine Schritte notiert.",
    deleteConfirm: (name: string) => `${name} löschen? Es verschwindet auch aus dem Wochenplan.`,
    deleteRecipe: "Rezept löschen",
    cancel: "Abbrechen",
    saveRecipe: "Rezept speichern",
    editTitle: (name: string) => `${name} bearbeiten`,
    amountsHint: "Die Mengen gelten für die Anzahl Portionen, die du einstellst.",
    name: "Name",
    minutesLabel: "Minuten",
    newNames: "Neue Namen werden zu neuen Zutaten",
    stepsPlaceholder: "Ein Schritt pro Zeile.\nZwiebeln würfeln.\nIn Olivenöl anbraten.",
    nameRequired: "Gib dem Rezept einen Namen.",
    nameTooLong: "Der Rezeptname darf höchstens 120 Zeichen haben.",
    nameInUse: "Ein Rezept hat bereits diesen Namen.",
    minutesInvalid: "Die Minuten müssen eine ganze Zahl von 1 bis 10000 sein.",
    duplicateIngredient: "Jede Zutat darf nur einmal vorkommen. Fasse die Mengen zusammen.",
    amountInvalid: "Jede Menge muss größer als 0 und höchstens 1000000 sein.",
    missingRecipe: "Dieses Rezept ist nicht mehr in dieser Küche."
  }
};

function allRecipes() {
  router.navigate("/recipes");
}

export function RecipePageContent({ data, recipeId }: { data: OpenKitchen; recipeId: string }) {
  const text = useText(TEXT);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const recipe = data.kitchen.recipes.find((one) => one.id === recipeId);
  if (recipeId === "new") return <RecipeEditor data={data} onDone={allRecipes} />;
  if (!recipe) return <Screen title={text.allRecipes} actions={<Button label={text.allRecipes} onPress={allRecipes} />}><Empty title={text.missingRecipe} /></Screen>;
  if (mode === "edit") return <RecipeEditor data={data} recipe={recipe} onDone={() => setMode("view")} />;
  return <RecipeView data={data} recipe={recipe} onEdit={() => setMode("edit")} />;
}

function RecipeView({ data, recipe, onEdit }: { data: OpenKitchen; recipe: Recipe; onEdit: () => void }) {
  const { kitchen, change } = data;
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const layout = useContentLayout();
  const wide = layout.detailColumns === 2;
  const [servings, setServings] = useState(recipe.servings);
  const [deleting, setDeleting] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const ingredients = new Map(kitchen.ingredients.map((one) => [one.id, one]));
  const groupOf = (id: string) => ingredients.get(id)?.section ?? "Other";
  const lines = byGroup(kitchen.kitchen.groups, scaledLines(recipe, servings), (line) => groupOf(line.ingredientId)).flatMap(([, group]) => group);
  const steps = recipe.instructions.split("\n").map((step) => step.trim()).filter(Boolean);
  const nutrition = nutritionPerServing(recipe, ingredients);

  return (
    <Screen title={recipe.name} facts={[recipe.minutes ? text.minutes(recipe.minutes) : "", text.servings(recipe.servings)].filter(Boolean).join(", ")}
      back={{ label: text.allRecipes, onPress: allRecipes }}
      floating={<Snackbar notice={notice} onUndo={change} onDone={() => setNotice(null)} />}
      toolbar={<>
        <ToolbarButton tone="outline" icon={Pencil} label={text.edit} onPress={onEdit} />
        <ToolbarButton icon={CalendarPlus} label={text.plan} onPress={() => setPlanning(true)} />
      </>}>
      <View style={{ flexDirection: wide ? "row" : "column", gap: wide ? 24 : 16, alignItems: "flex-start" }}>
        <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border, width: wide ? (layout.contentWidth - 24) / 2 : "100%" }]}>
          <View style={styles.row}>
            <T weight="semibold" style={styles.heading}>{text.ingredients}</T>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <T muted style={{ fontSize: 13 }}>{text.servingsLabel}</T>
              <Stepper label={text.servingsLabel} value={servings} onValue={setServings} />
            </View>
          </View>
          {lines.length ? <View style={{ gap: 8 }}>{lines.map((line, index) => (
            <View key={line.ingredientId} style={[styles.line, index < lines.length - 1 && { borderBottomWidth: 1, borderStyle: "dashed", borderBottomColor: colors.border, paddingBottom: 8 }]}>
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <GroupDot groups={kitchen.kitchen.groups} group={groupOf(line.ingredientId)} size={8} />
                <T style={{ flex: 1, fontSize: 14 }}>{line.ingredient}{line.note ? <T muted style={{ fontSize: 14 }}>, {line.note}</T> : null}</T>
              </View>
              <T weight="semibold" style={{ fontSize: 14 }}>{formatAmount(line.amount, line.unit, language)}</T>
            </View>
          ))}</View> : <T muted style={styles.body}>{text.noIngredients}</T>}
          {nutrition.kcal !== null ? <View style={{ backgroundColor: colors.muted, borderRadius: 12, padding: 12, gap: 8 }}>
            <View style={{ flexDirection: "row", gap: 4 }}>
              {([[text.kcal, nutrition.kcal, ""], [text.protein, nutrition.protein, " g"], [text.carbs, nutrition.carbs, " g"], [text.fat, nutrition.fat, " g"]] as const).map(([label, value, unit]) => (
                <View key={label} style={{ flex: 1, alignItems: "center", gap: 2 }}>
                  <T muted style={{ fontSize: 12, textAlign: "center" }}>{label}</T>
                  <T weight="semibold" style={{ fontSize: 18 }}>{value === null ? "?" : `${value}${unit}`}</T>
                </View>
              ))}
            </View>
            <T muted style={{ fontSize: 12, textAlign: "center" }}>{text.perServing}</T>
          </View> : lines.length ? <T muted style={{ fontSize: 12 }}>{text.addNutrition}</T> : null}
        </View>
        <View style={[{ gap: 12 }, wide ? { flex: 1 } : { width: "100%" }]}>
          <T weight="semibold" style={styles.heading}>{text.steps}</T>
          {steps.length ? steps.map((step, index) => <View key={index} style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: colors.muted }}><T weight="semibold" style={{ fontSize: 12 }}>{index + 1}</T></View>
            <T style={{ flex: 1, lineHeight: 24 }}>{step}</T>
          </View>) : <T muted style={styles.body}>{text.noSteps}</T>}
        </View>
      </View>
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 8, alignItems: "flex-start" }}>
        <Button tone="destructive" icon={Trash2} label={text.deleteRecipe} onPress={() => setDeleting(true)} />
      </View>
      {planning ? <RecipeMenu recipe={recipe} data={data} onClose={() => setPlanning(false)} notify={setNotice} onRecipe /> : null}
      <Sheet open={deleting} onClose={() => setDeleting(false)} title={text.deleteRecipe} description={text.deleteConfirm(recipe.name)}
        footer={<><Button tone="ghost" label={text.cancel} onPress={() => setDeleting(false)} /><Button tone="destructive" label={text.deleteRecipe} onPress={() => {
          setDeleting(false);
          change({ type: "recipe.delete", id: recipe.id });
          allRecipes();
        }} /></>}><View /></Sheet>
    </Screen>
  );
}

function RecipeEditor({ data: { kitchen, change }, recipe, onDone }: { data: OpenKitchen; recipe?: Recipe; onDone: () => void }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const [name, setName] = useState(recipe?.name ?? "");
  const [servings, setServings] = useState(recipe?.servings ?? 2);
  const [minutes, setMinutes] = useState(recipe?.minutes ? String(recipe.minutes) : "");
  const [instructions, setInstructions] = useState(recipe?.instructions ?? "");
  const [lines, setLines] = useState<DraftLine[]>(() => draftLines(recipe?.lines ?? [], language));
  const [error, setError] = useState<string>();
  const [createdId, setCreatedId] = useState<string>();
  const resolveLines = useResolveLines();

  useEffect(() => {
    if (createdId && kitchen.recipes.some((one) => one.id === createdId)) router.replace({ pathname: "/recipes/[recipeId]", params: { recipeId: createdId } });
  }, [createdId, kitchen.recipes]);

  function save() {
    if (createdId) return;
    setError(undefined);
    const prepared = lines.map((line) => ({ ...line, name: line.name.trim().replace(/\s+/g, " ") }));
    const invalid = recipeDraftError(name, minutes, prepared, kitchen.recipes, recipe?.id);
    if (invalid) return setError(text[invalid]);
    const resolved = resolveLines(prepared, kitchen.ingredients, change);
    if (typeof resolved === "string") return setError(resolved);
    const createId = recipe ? undefined : Crypto.randomUUID();
    change({ type: "recipe.save", id: recipe?.id, createId, name, servings, minutes: minutes ? Number(minutes) : null, instructions, lines: resolved });
    if (createId) setCreatedId(createId);
    else onDone();
  }

  return (
    <Screen title={recipe ? text.editTitle(recipe.name) : text.newRecipe} facts={text.amountsHint}
      actions={<><Button tone="ghost" label={text.cancel} onPress={onDone} disabled={Boolean(createdId)} /><Button label={text.saveRecipe} onPress={save} disabled={Boolean(createdId)} /></>}>
      <View style={{ gap: 16 }}>
        <View style={styles.field}>
          <T weight="medium">{text.name}</T>
          <Field accessibilityLabel={text.name} value={name} placeholder={text.namePlaceholder} maxLength={120} onChangeText={(value) => setName(value.replace(/\s*\n\s*/g, " "))} onSubmitEditing={save} />
        </View>
        <View style={styles.row}>
          <View style={styles.field}><T weight="medium">{text.servingsLabel}</T><Stepper label={text.servingsLabel} value={servings} onValue={setServings} /></View>
          <View style={[styles.field, { width: 110 }]}><T weight="medium">{text.minutesLabel}</T><Field accessibilityLabel={text.minutesLabel} value={minutes} placeholder={text.minutesPlaceholder} keyboardType="number-pad" maxLength={5} onChangeText={(value) => setMinutes(value.replace(/\D/g, ""))} /></View>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <T weight="semibold" style={styles.heading}>{text.ingredients}</T>
        <T muted style={{ fontSize: 12 }}>{text.newNames}</T>
        <LineEditor lines={lines} onLines={setLines} ingredients={kitchen.ingredients} groups={kitchen.kitchen.groups} />
      </View>
      <View style={styles.field}>
        <T weight="semibold">{text.steps}</T>
        <Field accessibilityLabel={text.steps} multiline value={instructions} placeholder={text.stepsPlaceholder} maxLength={20000} onChangeText={setInstructions} style={{ minHeight: 180, paddingVertical: 12, textAlignVertical: "top", lineHeight: 24 }} />
      </View>
      {error ? <T accessibilityRole="alert" style={{ color: colors.destructive, fontSize: 14 }}>{error}</T> : null}
      <View style={{ alignItems: "flex-end" }}><Button label={text.saveRecipe} onPress={save} disabled={Boolean(createdId)} /></View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 20, letterSpacing: -0.3 },
  panel: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 16 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 },
  line: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  body: { fontSize: 14 },
  field: { gap: 6 }
});
