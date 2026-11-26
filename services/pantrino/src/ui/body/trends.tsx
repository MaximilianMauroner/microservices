import { addDays, type BodyshopTrendDay } from "@tools-platform/service/bodyshop-contract";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { dayParts, Press, T } from "../kit";
import { LOCALES, useLanguage, useText } from "../language";
import { DayPlot } from "./day-plot";
import { tint, useColors } from "../theme";
import { TEXT } from "./text";

export type TrendMetric = Exclude<keyof BodyshopTrendDay, "day" | "status">;
const COPY = {
  en: {
    average: "Daily average",
    highest: "Highest day",
    prior: (value: string) => `Dashed line · Previous average ${value}`,
    coverage: (count: number, total: number) => `${count} of ${total} days recorded`,
    missing: "No data",
    empty: "No data for this metric in this period.",
    complete: "Calories are shown for complete food logs.",
    nutrition: "Totals reflect the nutrition recorded in your food log.",
  },
  de: {
    average: "Tagesdurchschnitt",
    highest: "Höchster Tageswert",
    prior: (value: string) => `Gestrichelte Linie · Vorheriger Durchschnitt ${value}`,
    coverage: (count: number, total: number) => `${count} von ${total} Tagen erfasst`,
    missing: "Keine Daten",
    empty: "Für diesen Wert gibt es in diesem Zeitraum keine Daten.",
    complete: "Kalorien werden für vollständige Ernährungsprotokolle angezeigt.",
    nutrition: "Die Summen basieren auf den erfassten Nährwerten im Ernährungsprotokoll.",
  },
};

export function DailyTrends({ days, end, range, metric, onMetric, choices, prior, title }: {
  days: readonly BodyshopTrendDay[];
  end: string;
  range: number;
  metric: TrendMetric;
  onMetric?: (next: TrendMetric) => void;
  choices?: readonly TrendMetric[];
  prior?: number | null;
  title?: string;
}) {
  const colors = useColors();
  const language = useLanguage();
  const text = useText(TEXT);
  const copy = useText(COPY);
  const [selectedDay, setSelectedDay] = useState<string>();
  const metrics = {
    kcal: { label: text.nutrients.kcal, unit: text.kcal, color: colors.nutrient.kcal },
    protein: { label: text.nutrients.protein, unit: "g", color: colors.nutrient.protein },
    carbs: { label: text.nutrients.carbs, unit: "g", color: colors.nutrient.carbs },
    fat: { label: text.nutrients.fat, unit: "g", color: colors.nutrient.fat },
    fiber: { label: text.nutrients.fiber, unit: "g", color: colors.nutrient.fiber },
    steps: { label: text.stepMetric, unit: "", color: colors.positive },
    sleep: { label: text.sleepMetric, unit: "h", color: colors.pageInk.kitchen },
  };
  const { unit, color } = metrics[metric];
  const from = addDays(end, 1 - range);
  const values = new Map(days.map((day) => [day.day, metric === "kcal" && day.status !== "Complete" ? null : day[metric]]));
  const series = Array.from({ length: range }, (_, index) => {
    const day = addDays(from, index);
    return { day, value: values.get(day) ?? null };
  });
  const recorded = series.flatMap(({ value }) => value === null ? [] : [value]);
  const highest = Math.max(0, ...recorded);
  const average = recorded.length ? recorded.reduce((sum, value) => sum + value, 0) / recorded.length : null;
  const selected = series.find(({ day }) => day === selectedDay) ?? series.findLast(({ value }) => value !== null);
  const selectedIndex = selected ? series.indexOf(selected) : -1;
  const formatter = new Intl.NumberFormat(LOCALES[language], { maximumFractionDigits: metric === "sleep" ? 1 : 0 });
  const format = (value: number | null) => value === null ? copy.missing : [formatter.format(value), unit].filter(Boolean).join(" ");

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <T accessibilityRole="header" weight="semibold" style={styles.title}>{title ?? metrics[metric].label}</T>
      {choices && onMetric ? <View accessibilityRole="radiogroup" style={[styles.controls, { flexWrap: "wrap" }]}>
        {choices.map((key) => (
          <Press key={key} accessibilityRole="radio" accessibilityState={{ selected: metric === key }}
            onPress={() => { onMetric(key); setSelectedDay(undefined); }}
            style={[styles.option, { backgroundColor: metric === key ? tint(metrics[key].color, 23, colors.card) : colors.muted }]}>
            <T weight={metric === key ? "semibold" : "regular"}>{metrics[key].label}</T>
          </Press>
        ))}
      </View> : null}
      {selected && recorded.length ? <>
        <View style={styles.selection}>
          <View accessibilityLiveRegion="polite" style={{ flex: 1 }}>
            <T weight="semibold" style={{ fontSize: 28 }}>{format(selected.value)}</T>
            <T muted>{dayParts(selected.day, language).dayMonth}</T>
          </View>
          {([[-1, ChevronLeft, text.previousDay], [1, ChevronRight, text.nextDay]] as const).map(([step, Icon, label]) => {
            const next = series[selectedIndex + step];
            return (
              <Press key={step} accessibilityRole="button" accessibilityLabel={label} disabled={!next}
                onPress={() => setSelectedDay(next?.day)} style={[styles.arrow, { borderColor: colors.border, opacity: next ? 1 : 0.4 }]}>
                <Icon size={18} color={colors.foreground} />
              </Press>
            );
          })}
        </View>
        <DayPlot points={series} selected={selectedIndex} onSelect={(index) => setSelectedDay(series[index]?.day)}
          label={metrics[metric].label} color={color} format={format} prior={prior} />
        {prior != null ? <T muted style={styles.small}>{copy.prior(format(prior))}</T> : null}
        <View style={[styles.stats, { borderTopColor: colors.border }]}>
          <View style={styles.stat}><T muted style={styles.small}>{copy.average}</T><T weight="semibold">{format(average)}</T></View>
          <View style={styles.stat}><T muted style={styles.small}>{copy.highest}</T><T weight="semibold">{format(highest)}</T></View>
        </View>
        <T muted style={styles.small}>{copy.coverage(recorded.length, range)}</T>
        {metric !== "steps" && metric !== "sleep" ? <T muted style={styles.small}>{metric === "kcal" ? copy.complete : copy.nutrition}</T> : null}
      </> : <T muted>{copy.empty}</T>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 16, borderRadius: 16, borderWidth: 1 },
  title: { fontSize: 18 },
  small: { fontSize: 12 },
  controls: { flexDirection: "row", gap: 6 },
  option: { minHeight: 44, justifyContent: "center", alignItems: "center", paddingHorizontal: 12, borderRadius: 9 },
  selection: { flexDirection: "row", alignItems: "center", gap: 8 },
  arrow: { width: 48, minHeight: 48, justifyContent: "center", alignItems: "center", borderWidth: 1, borderRadius: 12 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 12, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  stat: { flex: 1, minWidth: 100, gap: 2 },
});
