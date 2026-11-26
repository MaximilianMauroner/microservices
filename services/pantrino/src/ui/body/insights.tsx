import { addDays, type BodyshopAppSnapshot, dailyMeanWeights } from "@tools-platform/service/bodyshop-contract";
import { router } from "expo-router";
import { ChevronRight, Flame, Footprints, Moon, Scale } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { insightCoverage, overview, weeklyPatterns } from "../../body/insights";
import { dayParts, Press, Screen, T, useKitText } from "../kit";
import { LOCALES, useLanguage, useText } from "../language";
import { tint, useColors } from "../theme";
import { TEXT } from "./text";
import { EnergyCard } from "./energy";
import { HealthMetrics } from "./health-metrics";
import { DailyTrends, type TrendMetric } from "./trends";
import { WeightTrend } from "./weight";
import { useContentLayout } from "../responsive";

const NUTRITION = ["kcal", "protein", "carbs", "fat", "fiber"] as const;

const RANGES = [7, 30, 90] as const;

const COPY = {
  en: {
    through: (day: string) => `Through ${day}`,
    averages: "Daily averages",
    calories: "Calories",
    complete: "Complete logs",
    nutrition: "Nutrition trends",
    weighIns: "View weigh-ins",
    activity: "Activity and sleep",
    coverage: "Recording calendar",
    patterns: "Weekdays vs weekends",
    weekday: "Weekdays",
    weekend: "Weekends",
    groupDays: (count: number) => `${count} days recorded`,
    patternHint: "Based on finished days in the last 30 days.",
    coverageHint: "Filled cells have data. The pale outline marks an unfinished day.",
    recordedDay: "Recorded",
    missingDay: "Missing",
    unfinishedDay: "Day in progress",
    legend: "Current period above, previous below",
    recorded: (count: number, range: number) => `${count} of ${range} days recorded`,
    noData: "No data",
    sparse: "Too few days to compare",
    steady: "About the same as before",
    previous: (delta: string) => `${delta} vs previous period`,
    today: "Weight and sleep include today. Steps and nutrition end yesterday.",
    update: "Daily trends appear after Bodyshop sends your updated history.",
  },
  de: {
    through: (day: string) => `Bis ${day}`,
    averages: "Tagesdurchschnitte",
    calories: "Kalorien",
    complete: "Vollständige Protokolle",
    nutrition: "Ernährungsverläufe",
    weighIns: "Messungen ansehen",
    activity: "Aktivität und Schlaf",
    coverage: "Erfassungskalender",
    patterns: "Wochentage und Wochenenden",
    weekday: "Wochentage",
    weekend: "Wochenenden",
    groupDays: (count: number) => `${count} Tage erfasst`,
    patternHint: "Basierend auf abgeschlossenen Tagen der letzten 30 Tage.",
    coverageHint: "Gefüllte Felder enthalten Daten. Ein heller Rahmen markiert einen laufenden Tag.",
    recordedDay: "Erfasst",
    missingDay: "Fehlt",
    unfinishedDay: "Tag läuft noch",
    legend: "Aktueller Zeitraum oben, vorheriger unten",
    recorded: (count: number, range: number) => `${count} von ${range} Tagen erfasst`,
    noData: "Keine Daten",
    sparse: "Zu wenige Tage für einen Vergleich",
    steady: "Etwa wie im vorherigen Zeitraum",
    previous: (delta: string) => `${delta} zum vorherigen Zeitraum`,
    today: "Gewicht und Schlaf schließen heute ein. Schritte und Ernährung enden gestern.",
    update: "Tagesverläufe erscheinen, sobald Bodyshop den aktuellen Verlauf sendet.",
  },
};

export function Insights({ snapshot }: { snapshot: BodyshopAppSnapshot }) {
  const text = useText(TEXT);
  const copy = useText(COPY);
  const kit = useKitText();
  const colors = useColors();
  const language = useLanguage();
  const [range, setRange] = useState<(typeof RANGES)[number]>(7);
  const [metric, setMetric] = useState<TrendMetric>("kcal");
  const wide = useContentLayout().panes > 1;
  const metrics = {
    weight: { label: text.weightMetric, unit: "kg", icon: Scale, color: colors.pageInk.weight },
    steps: { label: text.stepMetric, unit: "", icon: Footprints, color: colors.positive },
    sleep: { label: text.sleepMetric, unit: "h", icon: Moon, color: colors.pageInk.insights },
    kcal: { label: copy.calories, unit: text.kcal, icon: Flame, color: colors.nutrient.kcal },
  };
  const trends = snapshot.trends ?? [];
  const history = snapshot.history ?? [];
  const rows = overview(trends, history, snapshot.today, range);
  const coverage = insightCoverage(trends, history, snapshot.today, range);
  const yesterday = addDays(snapshot.today, -1);
  const prior = (key: "kcal" | "steps" | "sleep") => rows.find((row) => row.metric === key)?.prior;
  const patterns = range >= 30 ? weeklyPatterns(trends, snapshot.today, range) : [];
  const hasComparisons = rows.some(({ prior }) => prior !== null);

  return (
    <Screen title={kit.tabs.insights[0]} facts={copy.through(dayParts(snapshot.today, language).dayMonth)} fullWidth={wide}>
      <View accessibilityRole="radiogroup" style={[styles.ranges, { backgroundColor: colors.muted }]}>
        {RANGES.map((days) => <Press key={days} accessibilityRole="radio" accessibilityState={{ selected: days === range }}
          onPress={() => setRange(days)} style={[styles.range, days === range && { backgroundColor: colors.page.insights }]}>
          <T weight="semibold" style={{ color: days === range ? "#fff" : colors.foreground }}>{text.trendDays(days)}</T>
        </Press>)}
      </View>
      {snapshot.energy ? <EnergyCard estimate={snapshot.energy} target={snapshot.targets.kcal} /> : null}
      <T accessibilityRole="header" weight="semibold" style={styles.heading}>{copy.averages}</T>
      <View style={styles.grid}>
          {rows.map(({ metric: key, value, prior, count }) => {
            const { label, unit, icon: Icon, color } = metrics[key];
            const digits = key === "steps" || key === "kcal" ? 0 : 1;
            const number = new Intl.NumberFormat(LOCALES[language], { maximumFractionDigits: digits });
            const signed = new Intl.NumberFormat(LOCALES[language], { maximumFractionDigits: digits, signDisplay: "exceptZero" });
            const amount = (n: number, signedValue = false) => [(signedValue ? signed : number).format(n), unit].filter(Boolean).join(" ");
            const delta = value === null || prior === null ? null : value - prior;
            const comparison = delta === null ? copy.sparse
              : Math.abs(delta) < 0.5 * 10 ** -digits ? copy.steady
                : copy.previous(amount(delta, true));
            const limit = Math.max(value ?? 0, prior ?? 0, 1);
            return (
              <View key={key}
                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.row}>
                  <Icon size={20} color={color} />
                  <T weight="semibold" style={{ flex: 1 }}>{label}</T>
                </View>
                <T weight="semibold" style={styles.value}>{value === null ? copy.noData : amount(value)}</T>
                {value !== null ? <T muted>{comparison}</T> : null}
                {value !== null && prior !== null ? <View pointerEvents="none" style={{ gap: 4 }}>
                  {[value, prior].map((n, index) => <View key={index} style={[styles.track, { backgroundColor: colors.muted }]}>
                    <View style={{ width: `${n / limit * 100}%`, height: "100%", backgroundColor: index === 0 ? color : tint(color, 40, colors.card) }} />
                  </View>)}
                </View> : null}
                <T muted style={styles.small}>{copy.recorded(count, range)}</T>
                {key === "kcal" ? <T muted style={styles.small}>{copy.complete}</T> : null}
              </View>
            );
          })}
      </View>
      {hasComparisons ? <T muted style={styles.small}>{copy.legend}</T> : null}
      <T muted style={styles.small}>{copy.today}</T>

      <T muted style={styles.small}>{text.swipeChart}</T>
      <View style={[styles.chartGroup, wide && styles.chartColumns]}>
        <View style={[styles.chartColumn, wide && { flex: 1 }]}>
          <WeightTrend key={range} days={dailyMeanWeights(history)} today={snapshot.today} period={range} />
          <Press accessibilityRole="button" onPress={() => router.navigate("/(tabs)/weight")} style={styles.detailLink}>
            <T weight="medium" style={{ color: colors.pageInk.weight, flex: 1 }}>{copy.weighIns}</T>
            <ChevronRight size={18} color={colors.pageInk.weight} />
          </Press>

          {snapshot.trends ? <>
            <DailyTrends key={`${metric}-${range}`} days={trends} end={yesterday} range={range}
              metric={metric} title={copy.nutrition} choices={NUTRITION} onMetric={setMetric} prior={metric === "kcal" ? prior("kcal") : null} />
          </> : <T muted>{copy.update}</T>}
        </View>

        {snapshot.trends ? <View style={[styles.chartColumn, wide && { flex: 1 }]}>
          <T accessibilityRole="header" weight="semibold" style={styles.heading}>{copy.activity}</T>
          <DailyTrends key={`steps-${range}`} days={trends} end={yesterday} range={range} metric="steps" prior={prior("steps")} />
          <DailyTrends key={`sleep-${range}`} days={trends} end={snapshot.today} range={range} metric="sleep" prior={prior("sleep")} />
        </View> : null}
      </View>

      <HealthMetrics range={range === 90 ? 30 : range} />

      {patterns.length ? <View style={[styles.coverage, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <T accessibilityRole="header" weight="semibold" style={styles.heading}>{copy.patterns}</T>
        <T muted style={styles.small}>{copy.patternHint}</T>
        {patterns.map(({ metric: key, groups }) => {
          const { label, color, unit } = metrics[key];
          const highest = Math.max(1, ...groups.map(({ average }) => average));
          const format = new Intl.NumberFormat(LOCALES[language], { maximumFractionDigits: key === "sleep" ? 1 : 0 });
          return (
            <View key={key} style={styles.pattern}>
              <T weight="semibold">{label}</T>
              {groups.map(({ count, average }, index) => (
                <View key={index} style={{ gap: 4 }}>
                  <View style={styles.row}>
                    <T style={{ flex: 1 }}>{index === 0 ? copy.weekday : copy.weekend}</T>
                    <T weight="medium">{[format.format(average), unit].filter(Boolean).join(" ")}</T>
                  </View>
                  <View style={[styles.track, { backgroundColor: colors.muted }]}>
                    <View style={{ width: `${average / highest * 100}%`, height: "100%", backgroundColor: color }} />
                  </View>
                  <T muted style={styles.small}>{copy.groupDays(count)}</T>
                </View>
              ))}
            </View>
          );
        })}
      </View> : null}

      {snapshot.trends ? <View style={[styles.coverage, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <T accessibilityRole="header" weight="semibold" style={styles.heading}>{copy.coverage}</T>
        {rows.map(({ metric: key }) => (
          <View key={key} accessible accessibilityLabel={`${metrics[key].label}. ${coverage.map((day) => {
            const status = (key === "steps" || key === "kcal") && day.day === snapshot.today
              ? copy.unfinishedDay : day[key] ? copy.recordedDay : copy.missingDay;
            return `${dayParts(day.day, language).dayMonth}: ${status}`;
          }).join(". ")}`} style={{ gap: 5 }}>
            <T style={styles.small}>{metrics[key].label}</T>
            <View style={styles.cells}>
              {coverage.map((day) => {
                const unfinished = (key === "steps" || key === "kcal") && day.day === snapshot.today;
                return <View key={day.day} style={[styles.cell, {
                  backgroundColor: day[key] ? metrics[key].color : unfinished ? colors.card : colors.muted,
                  borderColor: unfinished ? colors.controlBorder : "transparent",
                }]} />;
              })}
            </View>
          </View>
        ))}
        <View style={styles.coverageDates}>
          <T muted style={styles.small}>{dayParts(coverage[0]!.day, language).dayMonth}</T>
          <T muted style={styles.small}>{dayParts(snapshot.today, language).dayMonth}</T>
        </View>
        <T muted style={styles.small}>{copy.coverageHint}</T>
      </View> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  ranges: { flexDirection: "row", borderRadius: 12, gap: 4, padding: 4 },
  range: { minHeight: 44, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 9 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  heading: { fontSize: 18 },
  card: { flexBasis: "45%", flexGrow: 1, minWidth: 135, borderWidth: 1, borderRadius: 15, padding: 14, gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  value: { fontSize: 23, fontVariant: ["tabular-nums"] },
  small: { fontSize: 12 },
  chartGroup: { gap: 16 },
  chartColumns: { flexDirection: "row", alignItems: "flex-start" },
  chartColumn: { minWidth: 0, gap: 12 },
  detailLink: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12 },
  pattern: { gap: 8 },
  coverage: { padding: 16, gap: 12, borderWidth: 1, borderRadius: 16 },
  cells: { flexDirection: "row", gap: 2 },
  cell: { flex: 1, height: 12, borderWidth: 1, borderRadius: 2 },
  coverageDates: { flexDirection: "row", justifyContent: "space-between" },
  track: { height: 4, borderRadius: 2, overflow: "hidden" },
});
