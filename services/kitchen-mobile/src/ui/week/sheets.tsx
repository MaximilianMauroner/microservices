import { addDays, formatAmount, type Meal, MEALS, type PlanEntry } from "@tools-platform/service/kitchen-contract";
import { router } from "expo-router";
import { ChefHat, Pencil, RotateCcw } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { OpenKitchen } from "../../state";
import { Button, dayParts, Pill, PlateRing, SearchField, Sheet, Stepper, T, usePageColor } from "../kit";
import { useLanguage, useText } from "../language";
import { type DraftLine, draftLines, LineEditor, useResolveLines } from "../lines";
import { tint, useColors } from "../theme";
import { defaultMeal, type WeekView } from "./model";
import type { Notice } from "./page";
import { TEXT } from "./text";

type SheetProps = { data: OpenKitchen; week: WeekView; onClose: () => void; notify: (notice: Notice) => void };
type RecipePick = { kind: "recipe"; id: string } | { kind: "idea"; name: string };

export function PlanSheet({ day, data, week, onClose, notify }: SheetProps & { day: string }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const page = usePageColor();
  const [meal, setMeal] = useState<Meal>(() => defaultMeal(week.entries.filter((entry) => entry.day === day)));
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState<RecipePick | null>(null);
  const [servings, setServings] = useState(2);
  const typed = query.trim();
  const matches = week.recipes.filter((recipe) => recipe.name.toLowerCase().includes(typed.toLowerCase()));
  const recipe = week.recipes.find((one) => pick?.kind === "recipe" ? one.id === pick.id : pick?.kind === "idea" && one.name.toLowerCase() === pick.name.toLowerCase());
  const isNew = Boolean(typed) && !week.recipes.some((one) => one.name.toLowerCase() === typed.toLowerCase());
  const addingIdea = pick?.kind === "idea" && !recipe;
  const parts = dayParts(day, language);

  function addIdea() {
    if (!isNew || addingIdea) return;
    setPick({ kind: "idea", name: typed });
    setServings(2);
    data.change({ type: "recipe.save", name: typed, servings: 2, minutes: null, instructions: "", lines: [] });
    notify({ message: text.ideaAdded(typed) });
  }

  function plan() {
    if (!recipe) return;
    data.change({ type: "plan.add", day, meal, recipeId: recipe.id, servings });
    notify({ message: text.planned(recipe.name, parts.weekdayLong) });
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title={text.planTitle(parts.weekdayLong, parts.dayMonth)}
      footer={week.recipes.length ? (
        <View style={{ width: "100%", gap: 12 }}>
          <MealPicker value={meal} onValue={setMeal} />
          <View style={styles.row}>
            <Stepper label={text.servingsLabel} value={servings} onValue={setServings} unit={text.servingUnit(servings)} />
            <Button label={text.addToPlan} disabled={!recipe} onPress={plan} />
          </View>
          {!recipe ? <T muted style={styles.small}>{text.chooseRecipe}</T> : null}
        </View>
      ) : undefined}>
      {week.recipes.length ? <>
        <SearchField value={query} onValue={setQuery} label={text.findRecipe} />
        {isNew ? (
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: addingIdea || typed.length > 200 }} disabled={addingIdea || typed.length > 200} onPress={addIdea}
            style={[styles.idea, { borderColor: colors.controlBorder, backgroundColor: colors.control, opacity: addingIdea || typed.length > 200 ? 0.4 : 1 }]}>
            <T weight="medium">{text.addIdea(typed)}</T>
          </Pressable>
        ) : null}
        <View accessibilityLabel={text.recipes} style={{ gap: 4 }}>
          {matches.map((one) => {
            const selected = recipe?.id === one.id;
            return (
              <Pressable key={one.id} accessibilityRole="radio" accessibilityState={{ checked: selected }}
                onPress={() => { setPick({ kind: "recipe", id: one.id }); setServings(one.servings); }}
                style={[styles.recipe, { borderColor: selected ? page.hue : "transparent", backgroundColor: selected ? tint(page.hue, 12, colors.card) : "transparent" }]}>
                <PlateRing groups={data.kitchen.kitchen.groups} sections={one.sections} size={26} />
                <View style={{ flex: 1, gap: 4 }}>
                  <T weight="medium" style={{ fontSize: 16 }}>{one.name}</T>
                  <T muted style={styles.small}>{one.lines.length ? [one.minutes ? text.minutes(one.minutes) : "", one.kcal ? `${one.kcal} kcal` : ""].filter(Boolean).join(", ") : text.idea}</T>
                </View>
              </Pressable>
            );
          })}
          {!matches.length ? <T muted style={{ padding: 16, textAlign: "center" }}>{text.noRecipeMatch(query)}</T> : null}
        </View>
      </> : <>
        <T muted>{text.plansUseRecipes}</T>
        <Button label={text.addARecipe} onPress={() => { onClose(); router.navigate("/recipes"); }} />
      </>}
    </Sheet>
  );
}

export function EntrySheet({ entry, data, week, onClose, notify }: SheetProps & { entry: PlanEntry }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const page = usePageColor();
  const [servings, setServings] = useState(entry.servings);
  const [day, setDay] = useState(entry.day);
  const [meal, setMeal] = useState(entry.meal);
  const [leftover, setLeftover] = useState(0);
  const [editing, setEditing] = useState<{ lines: DraftLine[]; error?: string } | null>(null);
  const resolveLines = useResolveLines();
  const changed = servings !== entry.servings || day !== entry.day || meal !== entry.meal;
  const parts = dayParts(entry.day, language);
  const current = entry.lines.map((line) => ({ ingredientId: line.ingredientId, amount: line.amount, note: line.note }));
  const edit = entry.cooked ? null : editing;

  function saveLines() {
    if (!edit) return;
    const lines = resolveLines(edit.lines, data.kitchen.ingredients, data.change);
    if (typeof lines === "string") { setEditing({ ...edit, error: lines }); return; }
    data.change({ type: "plan.customize", id: entry.id, lines });
    notify({ message: text.changedForMeal, undo: entry.custom ? { type: "plan.customize", id: entry.id, lines: current } : { type: "plan.reset", id: entry.id } });
    setEditing(null);
  }

  function remove() {
    data.change({ type: "plan.remove", id: entry.id });
    notify({ message: text.removedFromPlan(entry.recipe), undo: { type: "plan.add", day: entry.day, meal: entry.meal, recipeId: entry.recipeId, servings: entry.servings } });
    onClose();
  }

  function save() {
    data.change({ type: "plan.update", id: entry.id, day, meal, servings });
    notify({ message: text.planChanged });
    onClose();
  }

  function cook() {
    if (changed || entry.cooked) return;
    data.change({ type: "plan.cook", id: entry.id, leftover: leftover ? { servings: leftover, useBy: addDays(data.today, 3) } : undefined });
    notify({ message: leftover ? text.cookedLeftover(leftover) : text.cookedTaken });
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title={entry.recipe}
      description={`${text.meals[entry.meal]}, ${parts.weekdayLong} ${parts.dayMonth}${entry.cooked ? text.cookedSuffix : ""}`}
      footer={edit ? (
        <View style={styles.footer}>
          <Button label={text.cancel} tone="ghost" onPress={() => setEditing(null)} />
          <Button label={text.saveForMeal} onPress={saveLines} />
        </View>
      ) : (
        <View style={styles.footer}>
          <Button label={text.remove} tone="destructive" onPress={remove} />
          {changed && !entry.cooked ? <Button label={text.saveChanges} tone="outline" onPress={save} /> : null}
          {!entry.cooked ? <Button label={text.markCooked} icon={ChefHat} disabled={changed} onPress={cook} /> : null}
        </View>
      )}>
      {edit ? <>
        <T muted>{text.editHint}</T>
        <LineEditor lines={edit.lines} onLines={(update) => setEditing((value) => value ? { lines: update(value.lines) } : value)} ingredients={data.kitchen.ingredients} />
        {edit.error ? <T accessibilityRole="alert" style={{ color: colors.destructive }}>{edit.error}</T> : null}
      </> : <View style={{ gap: 20 }}>
        {!entry.cooked ? <>
          <View style={styles.row}>
            <T weight="medium">{text.servingsLabel}</T>
            <Stepper label={text.servingsLabel} value={servings} onValue={(value) => { setServings(value); setLeftover((previous) => Math.min(previous, value)); }} />
          </View>
          <View style={{ gap: 8 }}>
            <T weight="medium">{text.day}</T>
            <View style={{ flexDirection: "row", gap: 2 }}>
              {week.days.map(({ day: option }) => {
                const date = dayParts(option, language);
                const selected = day === option;
                return (
                  <Pressable key={option} accessibilityRole="button" accessibilityLabel={`${date.weekdayLong} ${date.dayMonth}`} accessibilityState={{ selected }}
                    onPress={() => setDay(option)} style={[styles.dayChoice, { backgroundColor: selected ? page.hue : "transparent" }]}>
                    <T style={{ fontSize: 11, color: selected ? "#ffffff" : colors.mutedForeground }}>{date.weekday}</T>
                    <T weight="semibold" style={{ color: selected ? "#ffffff" : colors.foreground }}>{date.number}</T>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <MealPicker value={meal} onValue={setMeal} />
          <View style={[styles.leftover, { backgroundColor: colors.muted }]}>
            <View style={{ flexGrow: 1, flexBasis: 170, gap: 4 }}><T weight="medium">{text.leftoverLabel}</T><T muted style={styles.small}>{text.leftoverNote}</T></View>
            <Stepper label={text.leftoverAria} value={leftover} onValue={setLeftover} min={0} max={servings} />
          </View>
        </> : <T muted>{text.cookedMeal}</T>}
        <View accessibilityLabel={text.ingredientsLabel} style={{ gap: 10 }}>
          <View style={styles.row}><T weight="medium">{text.ingredientsLabel}</T>{entry.custom ? <Pill tone="accent">{text.onlyThisMeal}</Pill> : null}</View>
          {entry.lines.length ? entry.lines.map((line) => (
            <View key={line.ingredientId} style={styles.line}>
              <T style={{ flex: 1 }}>{line.ingredient}{line.note ? <T muted>, {line.note}</T> : null}</T>
              <T muted>{formatAmount(line.amount, line.unit, language)}</T>
            </View>
          )) : <T muted>{text.noIngredients}</T>}
          {!entry.cooked ? <>
            <View style={styles.footer}>
              <Button label={text.changeThisMeal} tone="outline" icon={Pencil} disabled={changed} onPress={() => setEditing({ lines: draftLines(entry.lines, language) })} />
              {entry.custom ? <Button label={text.useRecipeAgain} tone="ghost" icon={RotateCcw} onPress={() => {
                data.change({ type: "plan.reset", id: entry.id });
                notify({ message: text.backToRecipe, undo: { type: "plan.customize", id: entry.id, lines: current } });
              }} /> : null}
            </View>
            {changed ? <T muted style={styles.small}>{text.saveFirst}</T> : null}
          </> : null}
        </View>
        <Button label={text.openRecipe} tone="ghost" onPress={() => { onClose(); router.navigate({ pathname: "/recipes/[recipeId]", params: { recipeId: entry.recipeId } }); }} />
      </View>}
    </Sheet>
  );
}

function MealPicker({ value, onValue }: { value: Meal; onValue: (value: Meal) => void }) {
  const text = useText(TEXT);
  const colors = useColors();
  const page = usePageColor();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={text.meal} style={[styles.meals, { backgroundColor: colors.muted }]}>
      {MEALS.map((option) => (
        <Pressable key={option} accessibilityRole="radio" accessibilityState={{ checked: value === option }} onPress={() => onValue(option)}
          style={[styles.mealChoice, { backgroundColor: value === option ? page.hue : "transparent" }]}>
          <T weight="medium" style={{ fontSize: 12, textAlign: "center", color: value === option ? "#ffffff" : colors.mutedForeground }}>{text.meals[option]}</T>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  small: { fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  recipe: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  idea: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  footer: { width: "100%", flexDirection: "row", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 },
  dayChoice: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, gap: 3 },
  meals: { flexDirection: "row", gap: 2, padding: 4, borderRadius: 24 },
  mealChoice: { flex: 1, minHeight: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 },
  leftover: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, padding: 12, borderRadius: 12 },
  line: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
});
