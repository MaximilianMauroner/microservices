import { type BodyshopAppSnapshot, MEALS } from "@tools-platform/service/bodyshop-contract";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Press, T } from "../kit";
import { LOCALES, useLanguage, useText } from "../language";
import { tint, useColors } from "../theme";
import { TEXT } from "./text";

const COPY = {
  en: { title: "Food breakdown", meals: "By meal", foods: "Top foods", macros: "Macro split", energy: "Estimated energy from protein, carbs, and fat", incomplete: "Some entries are missing values for this chart." },
  de: { title: "Ernährungsübersicht", meals: "Nach Mahlzeit", foods: "Top-Lebensmittel", macros: "Makroverteilung", energy: "Geschätzte Energie aus Eiweiß, Kohlenhydraten und Fett", incomplete: "Für einige Einträge fehlen Werte für dieses Diagramm." },
};
const LIBRARY = {
  en: { title: "Compare saved foods", basis: "Per 100 g · Top five of the foods shown", empty: "None of these foods have this value recorded by weight." },
  de: { title: "Gespeicherte Lebensmittel vergleichen", basis: "Pro 100 g · Die fünf höchsten Werte der angezeigten Lebensmittel", empty: "Für keines dieser Lebensmittel ist dieser Wert nach Gewicht erfasst." },
};
const LIBRARY_METRICS = ["protein", "fiber", "kcal"] as const;
const VIEWS = ["meals", "foods", "macros"] as const;
const MACROS = { protein: 4, carbs: 4, fat: 9 } as const;

export function FoodCharts({ entries }: Pick<BodyshopAppSnapshot, "entries">) {
  const text = useText(TEXT);
  const copy = useText(COPY);
  const language = useLanguage();
  const colors = useColors();
  const [view, setView] = useState<(typeof VIEWS)[number]>("meals");
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (entry.nutrients.kcal === null) continue;
    totals.set(entry.food, (totals.get(entry.food) ?? 0) + entry.nutrients.kcal);
  }
  const rows = view === "macros"
    ? (Object.keys(MACROS) as (keyof typeof MACROS)[]).map((key) => {
      const grams = entries.reduce((total, entry) => total + (entry.nutrients[key] ?? 0), 0);
      return { label: text.nutrients[key], value: grams * MACROS[key], amount: grams, color: colors.nutrient[key] };
    })
    : (view === "meals"
      ? MEALS.map((meal, index) => ({
        label: text.meals[meal],
        value: entries.reduce((total, entry) => total + (entry.meal === meal ? entry.nutrients.kcal ?? 0 : 0), 0),
        color: colors.groups[index]!,
      }))
      : [...totals].sort(([, a], [, b]) => b - a).map(([label, value]) => ({ label, value, color: colors.nutrient.kcal }))
    ).map((row) => ({ ...row, amount: row.value }));
  const known = rows.filter(({ value }) => value > 0);
  const total = known.reduce((sum, row) => sum + row.value, 0);
  const incomplete = entries.some(({ nutrients }) => view === "macros"
    ? nutrients.protein === null || nutrients.carbs === null || nutrients.fat === null
    : nutrients.kcal === null);
  const number = new Intl.NumberFormat(LOCALES[language], { maximumFractionDigits: 0 });
  const percent = new Intl.NumberFormat(LOCALES[language], { style: "percent", maximumFractionDigits: 0 });

  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <T accessibilityRole="header" weight="semibold" style={{ fontSize: 18 }}>{copy.title}</T>
      <View accessibilityRole="radiogroup" style={styles.controls}>
        {VIEWS.map((key) => (
          <Press key={key} accessibilityRole="radio" accessibilityState={{ selected: view === key }}
            onPress={() => setView(key)} style={[styles.option, { borderColor: view === key ? colors.controlBorder : colors.muted, backgroundColor: view === key ? colors.card : colors.muted }]}>
            <T weight={view === key ? "semibold" : "regular"}>{copy[key]}</T>
          </Press>
        ))}
      </View>
      {known.length ? <>
        {view !== "foods" ? <View accessible={false} style={[styles.track, { height: 16, flexDirection: "row" }]}>
          {known.map(({ label, value, color }) => <View key={label} style={{ flex: value / total, backgroundColor: color }} />)}
        </View> : null}
        {known.slice(0, view === "foods" ? 5 : known.length).map(({ label, value, amount, color }) => (
          <View key={label} style={{ gap: 5 }}>
            <View style={styles.row}>
              {view !== "foods" ? <View style={[styles.dot, { backgroundColor: color }]} /> : null}
              <T style={{ flex: 1 }}>{label}</T>
              <T weight="medium">{number.format(amount)} {view === "macros" ? "g" : text.kcal}</T>
              <T muted style={{ minWidth: 42, textAlign: "right" }}>{percent.format(value / total)}</T>
            </View>
            {view === "foods" ? <View style={[styles.track, { height: 6, backgroundColor: tint(color, 15, colors.card) }]}>
              <View style={{ width: `${100 * value / known[0]!.value}%`, height: "100%", backgroundColor: color }} />
            </View> : null}
          </View>
        ))}
      </> : <T muted>{incomplete ? copy.incomplete : text.noNutritionToChart}</T>}
      {view === "macros" && known.length ? <T muted style={styles.detail}>{copy.energy}</T> : null}
      {known.length && incomplete ? <T muted style={styles.detail}>{copy.incomplete}</T> : null}
    </View>
  );
}

export function SavedFoodComparison({ foods }: Pick<BodyshopAppSnapshot, "foods">) {
  const text = useText(TEXT);
  const copy = useText(LIBRARY);
  const language = useLanguage();
  const colors = useColors();
  const [metric, setMetric] = useState<(typeof LIBRARY_METRICS)[number]>("protein");
  const ranked = foods.flatMap((food) => {
    const value = food.nutrients[metric];
    return food.unit.trim().toLowerCase() === "g" && food.amount > 0 && value != null
      ? [{ id: food.id, label: food.name, brand: food.brand, value: value * 100 / food.amount }]
      : [];
  }).sort((a, b) => b.value - a.value).slice(0, 5);
  const top = ranked[0]?.value ?? 0;
  const color = colors.nutrient[metric];
  const number = new Intl.NumberFormat(LOCALES[language], { maximumFractionDigits: 1 });

  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <T accessibilityRole="header" weight="semibold" style={{ fontSize: 18 }}>{copy.title}</T>
      <T muted style={styles.detail}>{copy.basis}</T>
      <View accessibilityRole="radiogroup" style={styles.controls}>
        {LIBRARY_METRICS.map((key) => (
          <Press key={key} accessibilityRole="radio" accessibilityState={{ selected: metric === key }}
            onPress={() => setMetric(key)} style={[styles.option, { borderColor: metric === key ? colors.controlBorder : colors.muted, backgroundColor: metric === key ? colors.card : colors.muted }]}>
            <T weight={metric === key ? "semibold" : "regular"}>{text.nutrients[key]}</T>
          </Press>
        ))}
      </View>
      {ranked.length ? ranked.map(({ id, label, brand, value }) => (
        <View key={id} style={{ gap: 5 }}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <T>{label}</T>
              {brand ? <T muted style={styles.detail}>{brand}</T> : null}
            </View>
            <T weight="medium">{number.format(value)} {metric === "kcal" ? text.kcal : "g"}</T>
          </View>
          <View style={[styles.track, { height: 6, backgroundColor: tint(color, 15, colors.card) }]}>
            <View style={{ width: `${top > 0 ? 100 * value / top : 0}%`, height: "100%", backgroundColor: color }} />
          </View>
        </View>
      )) : <T muted>{copy.empty}</T>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 16, borderRadius: 16, borderWidth: 1 },
  controls: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  option: { minHeight: 44, paddingHorizontal: 10, justifyContent: "center", alignItems: "center", borderWidth: 1, borderRadius: 9 },
  track: { borderRadius: 8, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  detail: { fontSize: 12 },
});
