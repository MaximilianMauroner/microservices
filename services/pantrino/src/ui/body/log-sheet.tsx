import { type Meal, MEALS } from "@tools-platform/service/bodyshop-contract";
import { fieldNumber, formatNumber, unitName, type IngredientUnit, INGREDIENT_UNITS } from "@tools-platform/service/kitchen-contract";
import { ScanBarcode } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { bodyStore, useBody } from "../../body/store";
import { fromScan, type Loggable, logAction, mealAt, scaled } from "../../body/model";
import { useKitchen } from "../../state";
import { Button, Field, type Notice, Press, SearchField, Sheet, T, usePageColor } from "../kit";
import { type KitchenLanguage, useLanguage, useText } from "../language";
import { Scanner } from "../scan/scanner";
import { search, type SearchHit, searchIndex } from "../search/model";
import { useColors } from "../theme";
import { TEXT } from "./text";

/** How a unit reads to a person. Kitchen units have their own names; Bodyshop units are written as saved. */
export function unitLabel(unit: string, language: KitchenLanguage, amount?: number): string {
  return (INGREDIENT_UNITS as readonly string[]).includes(unit) ? unitName(unit as IngredientUnit, language, amount) : unit;
}

/** Where a loggable comes from, in words. */
export function useOrigin() {
  const text = useText(TEXT);
  return (food: Loggable) => ({ bodyshop: text.fromBodyshop, recipe: text.fromRecipe, ingredient: text.fromIngredient, scan: text.fromScan })[food.origin];
}

/**
 * Logs food in Bodyshop. Without a food, it searches Bodyshop foods, Kitchen recipes, Kitchen ingredients, and recurring
 * meals, or scans a package. With a food, it asks how much and for which meal, and shows the values before it logs.
 */
export function LogSheet({ initial, meal: startMeal, day, onClose, notify }: {
  initial?: Loggable; meal?: Meal; day?: string; onClose: () => void; notify: (notice: Notice) => void;
}) {
  const text = useText(TEXT);
  const origin = useOrigin();
  const [food, setFood] = useState<Loggable | undefined>(initial);
  const body = useBody();
  const logDay = day ?? body.snapshot?.day ?? body.snapshot?.today;
  return (
    <Sheet open onClose={onClose} title={food?.name || text.logFood} description={food ? origin(food) : undefined}>
      {!logDay ? <T muted>{text.loading}</T>
        : food ? <Amount key={`${food.origin}:${food.name}`} food={food} meal={startMeal} day={logDay} onBack={initial ? undefined : () => setFood(undefined)} onClose={onClose} notify={notify} />
        : <Pick day={logDay} onFood={setFood} onClose={onClose} notify={notify} />}
    </Sheet>
  );
}

/** The search over both products. The scanner opens inside the sheet, since iOS shows no second modal beside an open one. */
function Pick({ day, onFood, onClose, notify }: { day: string; onFood: (food: Loggable) => void; onClose: () => void; notify: (notice: Notice) => void }) {
  const text = useText(TEXT);
  const kitchen = useKitchen();
  const body = useBody();
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string>();
  const index = searchIndex(kitchen?.kitchen ?? null, body.snapshot);
  const hits = query.trim() ? search(index, query) : index.filter((hit) => hit.kind === "food").slice(0, 12);

  async function logMeal(hit: SearchHit) {
    const result = await bodyStore.act({ type: "meal.log", day, template: hit.id });
    if (result.ok) { notify({ message: text.logged(hit.label) }); onClose(); return; }
    setError(result.reason === "refused" ? result.message : result.reason === "offline" ? text.needsConnection : text.failed);
  }

  return (
    <>
      <View style={{ flexDirection: "row", gap: 6 }}>
        <View style={{ flex: 1 }}><SearchField value={query} onValue={setQuery} label={text.search} /></View>
        <Button tone="outline" icon={ScanBarcode} accessibilityLabel={text.scan} onPress={() => setScanning(true)} />
      </View>
      {error ? <T accessibilityRole="alert">{error}</T> : null}
      <View style={{ gap: 2 }}>
        {hits.map((hit) => <HitRow key={hit.key} hit={hit} onPress={() => hit.loggable ? onFood(hit.loggable) : void logMeal(hit)} />)}
        {query.trim() && !hits.length ? <T muted style={{ padding: 16, textAlign: "center" }}>{text.noMatch(query.trim())}</T> : null}
      </View>
      {scanning ? <Scanner onResult={(result) => onFood(fromScan(result))} onClose={() => setScanning(false)} /> : null}
    </>
  );
}

/** One search hit: its name, where it comes from, and its calories. */
export function HitRow({ hit, onPress, action }: { hit: SearchHit; onPress: () => void; action?: ReactNode }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const origin = useOrigin();
  const food = hit.loggable;
  const kind = food ? origin(food) : text.recurringMeal;
  const kcal = food?.nutrients.kcal;
  const detail = [hit.brand, kind, kcal != null && food ? `${formatNumber(kcal, language)} ${text.kcal} ${text.per(formatNumber(food.per, language), unitLabel(food.unit, language, food.per))}` : ""].filter(Boolean).join(" · ");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Press accessibilityRole="button" onPress={onPress}
        style={({ pressed }) => ({ flex: 1, minHeight: 52, justifyContent: "center", gap: 2, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 12, backgroundColor: pressed ? colors.muted : "transparent" })}>
        <T weight="medium">{hit.label}</T>
        <T muted style={{ fontSize: 12 }}>{detail}</T>
      </Press>
      {action}
    </View>
  );
}

function Amount({ food, meal: startMeal, day, onBack, onClose, notify }: {
  food: Loggable; meal?: Meal; day: string; onBack?: () => void; onClose: () => void; notify: (notice: Notice) => void;
}) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const { hue } = usePageColor();
  const origin = useOrigin();
  const [name, setName] = useState(food.name);
  const [amount, setAmount] = useState(() => fieldNumber(food.usual, language));
  const [meal, setMeal] = useState<Meal>(() => startMeal ?? mealAt(new Date()));
  const [kcal, setKcal] = useState("");
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const value = Number(amount.replace(",", "."));
  const typedKcal = kcal.trim() ? Number(kcal.replace(",", ".")) : undefined;
  const unknownKcal = food.nutrients.kcal === null;
  const ready = name.trim().length > 0 && value > 0 && value <= 100_000 && (!unknownKcal || (typedKcal !== undefined && typedKcal >= 0 && typedKcal <= 20_000));
  const values = value > 0 ? scaled(food, value) : null;
  const canSave = !food.savedId && food.nutrients.kcal !== null;

  async function log() {
    if (!ready || busy) return;
    setBusy(true);
    setError(undefined);
    let target = food;
    if (save && canSave) {
      const saved = await bodyStore.act({ type: "food.save", name: name.trim(), amount: food.per, unit: food.unit, nutrients: { ...food.nutrients, kcal: food.nutrients.kcal! }, source: origin(food) });
      if (!saved.ok) { setBusy(false); setError(saved.reason === "refused" ? saved.message : saved.reason === "offline" ? text.needsConnection : text.failed); return; }
      const stored = bodyStore.getState().snapshot?.foods.find((one) => one.name.toLowerCase() === name.trim().toLowerCase());
      if (stored) target = { ...food, savedId: stored.id };
    }
    const result = await bodyStore.act(logAction(target, { name, amount: value, meal, day, kcal: typedKcal }));
    setBusy(false);
    if (result.ok) {
      notify({ message: result.repeated ? text.alreadyLogged(name.trim()) : text.logged(name.trim()) });
      onClose();
      return;
    }
    setError(result.reason === "refused" ? result.message : result.reason === "offline" ? text.needsConnection : text.failed);
  }

  return (
    <>
      {!food.name || food.origin === "scan" ? <View style={{ gap: 6 }}>
        <T weight="medium">{text.name}</T>
        <Field accessibilityLabel={text.name} value={name} onChangeText={setName} placeholder={text.namePlaceholder} maxLength={200} />
      </View> : null}
      <View style={{ gap: 6 }}>
        <T weight="medium">{text.amount}</T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Field accessibilityLabel={text.amount} value={amount} onChangeText={setAmount} inputMode="decimal" style={{ width: 140, fontVariant: ["tabular-nums"] }} />
          <T muted>{unitLabel(food.unit, language, value)}</T>
        </View>
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={text.meal} style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {MEALS.map((one) => (
          <Press key={one} accessibilityRole="radio" accessibilityState={{ checked: meal === one }} onPress={() => setMeal(one)}
            style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: 22, backgroundColor: meal === one ? hue : colors.muted }}>
            <T weight="medium" style={{ fontSize: 14, color: meal === one ? "#ffffff" : colors.foreground }}>{text.meals[one]}</T>
          </Press>
        ))}
      </View>
      {unknownKcal ? <View style={{ gap: 6 }}>
        <T muted style={{ fontSize: 12 }}>{text.kcalUnknown}</T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Field accessibilityLabel={text.kcalFor} value={kcal} onChangeText={setKcal} inputMode="decimal" placeholder="–" style={{ width: 140 }} />
          <T muted>{text.kcal}</T>
        </View>
      </View> : null}
      {values ? <View style={{ flexDirection: "row", gap: 4, padding: 12, borderRadius: 12, backgroundColor: colors.muted }}>
        {(["kcal", "protein", "carbs", "fat"] as const).map((key) => {
          const shown = key === "kcal" && unknownKcal ? typedKcal ?? null : values[key];
          return (
            <View key={key} style={{ flex: 1, alignItems: "center", gap: 2 }}>
              <T muted style={{ fontSize: 12, textAlign: "center" }}>{text.nutrients[key]}</T>
              <T weight="semibold" style={{ fontSize: 17, color: colors.nutrient[key] }}>{shown === null ? "?" : `${formatNumber(Math.round(shown), language)}${key === "kcal" ? "" : " g"}`}</T>
            </View>
          );
        })}
      </View> : null}
      {canSave ? (
        <Press accessibilityRole="checkbox" accessibilityState={{ checked: save }} onPress={() => setSave(!save)} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 }}>
          <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: save ? 0 : 1.5, borderColor: colors.controlBorder, backgroundColor: save ? hue : "transparent" }} />
          <T style={{ flex: 1 }}>{text.saveToFoods}</T>
        </Press>
      ) : null}
      {error ? <T accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</T> : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingTop: 4 }}>
        {onBack ? <Button tone="ghost" label={text.back} onPress={onBack} /> : null}
        <Button wide label={text.log} disabled={!ready || busy} onPress={() => void log()} />
      </View>
    </>
  );
}
