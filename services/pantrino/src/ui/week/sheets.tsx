import { addDays, formatAmount, type Meal, MEALS, type PlanEntry, type Recipe, weekStart } from "@tools-platform/service/kitchen-contract";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { AlarmClock, ChefHat, Pencil, RotateCcw } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { type OpenKitchen, useKitchen } from "../../state";
import { Button, dayParts, Pill, PlateRing, Press, SearchField, Sheet, Stepper, T, type Notice, usePageColor } from "../kit";
import { useLanguage, useText } from "../language";
import { type DraftLine, draftLines, LineEditor, useResolveLines } from "../lines";
import { useColors } from "../theme";
import { defaultMeal, moveStrip, planStrip, type WeekView } from "./model";
import { bodyMeal, fromRecipe } from "../../body/model";
import { useBody } from "../../body/store";
import { LogSheet } from "../body/log-sheet";
import { TEXT as BODY_TEXT } from "../body/text";
import { TEXT } from "./text";

/** The weekday for a day in the coming week. A later day also gets its date, so "Tuesday" never means two days. */
function useDayName() {
  const language = useLanguage();
  const today = useKitchen()?.today;
  return (day: string) => {
    const parts = dayParts(day, language);
    return today && day >= today && day < addDays(today, 7) ? parts.weekdayLong : `${parts.weekdayLong} ${parts.dayMonth}`;
  };
}

type SheetProps = { data: OpenKitchen; week: WeekView; onClose: () => void; notify: (notice: Notice) => void };

/** Day, meal, and recipe in one short sheet. A tap on a recipe plans it with the recipe's servings. */
export function PlanSheet({ day, data, week, onClose, notify }: SheetProps & { day?: string }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const [strip] = useState(() => planStrip({ weekStart: week.start, today: data.today, plan: data.kitchen.plan, day }));
  const [selected, setSelected] = useState(strip.selected);
  const [meal, setMeal] = useState<Meal>(() => mealFor(strip.selected));
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const matches = week.recipes.filter((recipe) => recipe.name.toLowerCase().includes(typed.toLowerCase()));
  const isNew = typed.length > 0 && typed.length <= 200 && !week.recipes.some((one) => one.name.toLowerCase() === typed.toLowerCase());
  const weekday = useDayName()(selected);

  function mealFor(one: string): Meal {
    return defaultMeal(data.kitchen.plan.filter((entry) => entry.day === one));
  }

  function plan(recipe: Pick<Recipe, "id" | "name" | "servings">) {
    const id = Crypto.randomUUID();
    data.change({ type: "plan.add", createId: id, day: selected, meal, recipeId: recipe.id, servings: recipe.servings });
    notify({ message: text.planned(recipe.name, weekday), undo: [{ type: "plan.remove", id }] });
    onClose();
  }

  function planIdea() {
    const id = Crypto.randomUUID();
    data.change({ type: "recipe.save", createId: id, name: typed, servings: 2, minutes: null, instructions: "", lines: [] });
    plan({ id, name: typed, servings: 2 });
  }

  return (
    <Sheet open onClose={onClose} title={text.planAMeal}>
      {week.recipes.length ? <>
        <DayStrip days={strip.days} value={selected} planned={new Set(data.kitchen.plan.map((entry) => entry.day))} onValue={(one) => { setSelected(one); setMeal(mealFor(one)); }} />
        <MealPicker value={meal} onValue={setMeal} />
        <SearchField value={query} onValue={setQuery} label={text.findRecipe} />
        {isNew ? (
          <Press accessibilityRole="button" onPress={planIdea} style={[styles.idea, { borderColor: colors.controlBorder, backgroundColor: colors.control }]}>
            <T weight="medium">{text.planIdea(typed)}</T>
          </Press>
        ) : null}
        <View accessibilityLabel={text.recipes} style={{ gap: 4 }}>
          {matches.map((one) => (
            <Press key={one.id} accessibilityRole="button" accessibilityHint={text.planHint(text.meals[meal], weekday)} onPress={() => plan(one)}
              style={({ pressed }) => [styles.recipe, { backgroundColor: pressed ? colors.muted : "transparent" }]}>
              <PlateRing groups={data.kitchen.kitchen.groups} sections={one.sections} size={26} />
              <View style={{ flex: 1, gap: 4 }}>
                <T weight="medium" style={{ fontSize: 16 }}>{one.name}</T>
                <T muted style={styles.small}>{[one.lines.length ? "" : text.idea, one.minutes ? text.minutes(one.minutes) : "", text.servings(one.servings), one.kcal ? `${one.kcal} kcal` : ""].filter(Boolean).join(", ")}</T>
              </View>
            </Press>
          ))}
          {!matches.length ? <T muted style={{ padding: 16, textAlign: "center" }}>{text.noRecipeMatch(query)}</T> : null}
        </View>
      </> : <>
        <T muted>{text.plansUseRecipes}</T>
        <Button label={text.addARecipe} onPress={() => { onClose(); router.navigate("/recipes"); }} />
      </>}
    </Sheet>
  );
}

/** The short menu a held recipe opens: plan it on a day of the coming week, or open it. */
export function RecipeMenu({ recipe, data, onClose, notify, onRecipe }: { recipe: Pick<Recipe, "id" | "name" | "servings">; data: OpenKitchen; onClose: () => void; notify: (notice: Notice) => void; onRecipe?: boolean }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const [strip] = useState(() => planStrip({ weekStart: weekStart(data.today), today: data.today, plan: data.kitchen.plan }));
  const [selected, setSelected] = useState(strip.selected);
  const mealFor = (one: string) => defaultMeal(data.kitchen.plan.filter((entry) => entry.day === one));
  const [meal, setMeal] = useState<Meal>(() => mealFor(strip.selected));
  const weekday = useDayName()(selected);

  function plan() {
    const id = Crypto.randomUUID();
    data.change({ type: "plan.add", createId: id, day: selected, meal, recipeId: recipe.id, servings: recipe.servings });
    notify({ message: text.planned(recipe.name, weekday), undo: [{ type: "plan.remove", id }] });
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title={recipe.name}
      footer={<View style={styles.footer}>
        {onRecipe ? null : <Button tone="outline" label={text.openRecipe} onPress={() => { onClose(); router.push({ pathname: "/recipes/[recipeId]", params: { recipeId: recipe.id } }); }} />}
        <Button wide label={text.plan} accessibilityLabel={text.planOn(text.meals[meal], weekday)} onPress={plan} />
      </View>}>
      <DayStrip days={strip.days} value={selected} planned={new Set(data.kitchen.plan.map((entry) => entry.day))} onValue={(one) => { setSelected(one); setMeal(mealFor(one)); }} />
      <MealPicker value={meal} onValue={setMeal} />
    </Sheet>
  );
}

/** The short menu a held meal opens. Each action runs at once. A cooked meal can only be removed. */
export function MealMenu({ entry, data, week, onClose, notify }: SheetProps & { entry: PlanEntry }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const parts = dayParts(entry.day, language);
  const dayName = useDayName();
  const update = (patch: Partial<Pick<PlanEntry, "day" | "servings">>) =>
    data.change({ type: "plan.update", id: entry.id, day: entry.day, meal: entry.meal, servings: entry.servings, ...patch });

  function move(day: string) {
    update({ day });
    notify({ message: text.movedTo(dayName(day)), undo: [{ type: "plan.update", id: entry.id, day: entry.day, meal: entry.meal, servings: entry.servings }] });
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title={entry.recipe}
      description={`${text.meals[entry.meal]}, ${parts.weekdayLong} ${parts.dayMonth}${entry.cooked ? text.cookedSuffix : ""}`}
      footer={
        <View style={styles.footer}>
          <Button label={text.remove} tone="destructive" onPress={() => { removeMeal(entry, data, notify, text); onClose(); }} />
          {!entry.cooked ? <Button label={text.nextWeek} tone="outline" icon={AlarmClock} accessibilityLabel={text.snoozeTo(dayName(addDays(entry.day, 7)))} onPress={() => move(addDays(entry.day, 7))} /> : null}
          {!entry.cooked ? <Button label={text.markCooked} icon={ChefHat} onPress={() => { data.change({ type: "plan.cook", id: entry.id }); notify({ message: text.cookedTaken }); onClose(); }} /> : null}
        </View>
      }>
      {entry.cooked ? <T muted>{text.cookedMeal}</T> : <>
        <View style={styles.row}>
          <T weight="medium">{text.servingsLabel}</T>
          <Stepper label={text.servingsLabel} value={entry.servings} onValue={(servings) => update({ servings })} />
        </View>
        <View style={{ gap: 8 }}>
          <T weight="medium">{text.moveTo}</T>
          <DayStrip days={moveStrip(entry.day)} value={entry.day} onValue={(day) => { if (day !== entry.day) move(day); }} />
        </View>
      </>}
    </Sheet>
  );
}

function removeMeal(entry: PlanEntry, data: OpenKitchen, notify: (notice: Notice) => void, text: (typeof TEXT)[keyof typeof TEXT]) {
  data.change({ type: "plan.remove", id: entry.id });
  notify({ message: text.removedFromPlan(entry.recipe), undo: [{ type: "plan.add", day: entry.day, meal: entry.meal, recipeId: entry.recipeId, servings: entry.servings }] });
}

export function EntrySheet({ entry, data, week, onClose, notify }: SheetProps & { entry: PlanEntry }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const [servings, setServings] = useState(entry.servings);
  const [day, setDay] = useState(entry.day);
  const [meal, setMeal] = useState(entry.meal);
  const [leftover, setLeftover] = useState(0);
  const [editing, setEditing] = useState<{ lines: DraftLine[]; error?: string } | null>(null);
  const [logging, setLogging] = useState(false);
  const body = useBody();
  const bodyText = useText(BODY_TEXT);
  const bodyToday = body.status !== "no-access" ? body.snapshot?.today : undefined;
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
    notify({ message: text.changedForMeal, undo: [entry.custom ? { type: "plan.customize", id: entry.id, lines: current } : { type: "plan.reset", id: entry.id }] });
    setEditing(null);
  }

  function remove() {
    removeMeal(entry, data, notify, text);
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
        <LineEditor lines={edit.lines} onLines={(update) => setEditing((value) => value ? { lines: update(value.lines) } : value)} ingredients={data.kitchen.ingredients} groups={data.kitchen.kitchen.groups} />
        {edit.error ? <T accessibilityRole="alert" style={{ color: colors.destructive }}>{edit.error}</T> : null}
      </> : <View style={{ gap: 20 }}>
        {!entry.cooked ? <>
          <View style={styles.row}>
            <T weight="medium">{text.servingsLabel}</T>
            <Stepper label={text.servingsLabel} value={servings} onValue={(value) => { setServings(value); setLeftover((previous) => Math.min(previous, value)); }} />
          </View>
          <View style={{ gap: 8 }}>
            <T weight="medium">{text.day}</T>
            <DayStrip days={moveStrip(entry.day)} value={day} onValue={setDay} />
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
                notify({ message: text.backToRecipe, undo: [{ type: "plan.customize", id: entry.id, lines: current }] });
              }} /> : null}
            </View>
            {changed ? <T muted style={styles.small}>{text.saveFirst}</T> : null}
          </> : null}
        </View>
        <View style={styles.footer}>
          {bodyToday && entry.day <= bodyToday ? <Button label={bodyText.logInBodyshop} tone="outline" onPress={() => setLogging(true)} /> : null}
          <Button label={text.openRecipe} tone="ghost" onPress={() => { onClose(); router.navigate({ pathname: "/recipes/[recipeId]", params: { recipeId: entry.recipeId } }); }} />
        </View>
        {logging ? <LogSheet initial={fromRecipe({ name: entry.recipe, servings: entry.servings, lines: entry.lines }, new Map(data.kitchen.ingredients.map((one) => [one.id, one])))}
          meal={bodyMeal(entry.meal)} day={entry.day} onClose={() => setLogging(false)} notify={notify} /> : null}
      </View>}
    </Sheet>
  );
}

/** Days to pick from. Seven fit the width, and more scroll in sideways. A line marks each new week, and a dot marks a day that has a meal already. */
function DayStrip({ days, value, onValue, planned }: { days: readonly string[]; value: string; onValue: (day: string) => void; planned?: ReadonlySet<string> }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const page = usePageColor();
  const today = useKitchen()?.today;
  const [width, setWidth] = useState(0);
  const chip = width / 7;
  const shownWeek = Math.floor(Math.max(0, days.indexOf(value)) / 7);
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ minHeight: 48 }}>
      {chip ? <ScrollView horizontal contentOffset={{ x: shownWeek * 7 * chip, y: 0 }} showsHorizontalScrollIndicator={false} snapToInterval={chip * 7 || undefined} decelerationRate="fast" scrollEnabled={days.length > 7}
        accessibilityRole="radiogroup" accessibilityLabel={text.day}>
        {days.map((option, index) => {
          const date = dayParts(option, language);
          const selected = value === option;
          const monday = index > 0 && option === weekStart(option);
          return (
            <Press key={option} accessibilityRole="radio" accessibilityLabel={`${date.weekdayLong} ${date.dayMonth}`} accessibilityState={{ checked: selected }}
              onPress={() => onValue(option)} style={[styles.dayChoice, { width: chip, backgroundColor: selected ? page.hue : "transparent", borderLeftWidth: monday ? StyleSheet.hairlineWidth : 0, borderLeftColor: colors.border }]}>
              <T weight={option === today ? "semibold" : "regular"} style={{ fontSize: 11, color: selected ? "#ffffff" : option === today ? page.ink : colors.mutedForeground }}>{option === today ? text.today : date.weekday}</T>
              <T weight="semibold" style={{ color: selected ? "#ffffff" : colors.foreground }}>{date.number}</T>
              <View style={[styles.planned, { backgroundColor: planned?.has(option) ? (selected ? "#ffffff" : page.ink) : "transparent" }]} />
            </Press>
          );
        })}
      </ScrollView> : null}
      {days.length > 7 ? <T muted style={{ fontSize: 11, textAlign: "right", paddingTop: 4 }}>{text.swipeForWeeks}</T> : null}
    </View>
  );
}

function MealPicker({ value, onValue }: { value: Meal; onValue: (value: Meal) => void }) {
  const text = useText(TEXT);
  const colors = useColors();
  const page = usePageColor();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={text.meal} style={[styles.meals, { backgroundColor: colors.muted }]}>
      {MEALS.map((option) => (
        <Press key={option} accessibilityRole="radio" accessibilityState={{ checked: value === option }} onPress={() => onValue(option)}
          style={[styles.mealChoice, { backgroundColor: value === option ? page.hue : "transparent" }]}>
          <T weight="medium" style={{ fontSize: 12, textAlign: "center", color: value === option ? "#ffffff" : colors.mutedForeground }}>{text.meals[option]}</T>
        </Press>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  small: { fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  recipe: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  idea: { minHeight: 48, justifyContent: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  footer: { width: "100%", flexDirection: "row", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 },
  dayChoice: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, gap: 3 },
  planned: { width: 4, height: 4, borderRadius: 2 },
  meals: { flexDirection: "row", gap: 2, padding: 4, borderRadius: 24 },
  mealChoice: { flex: 1, minHeight: 48, borderRadius: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 },
  leftover: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, padding: 12, borderRadius: 12 },
  line: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
});
