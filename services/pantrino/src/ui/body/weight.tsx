import { addDays, type BodyshopAppSnapshot, daysBetween, type WeightReading } from "@tools-platform/service/bodyshop-contract";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Line, Polygon, Polyline } from "react-native-svg";
import { bodyStore } from "../../body/store";
import { rollingWeightAverages, weightSummary } from "../../body/weight";
import { Button, dayParts, Empty, Field, type Notice, Press, Screen, Sheet, Snackbar, T, usePageColor } from "../kit";
import { type KitchenLanguage, useLanguage, useText } from "../language";
import { useContentLayout } from "../responsive";
import { SwipeStepArea } from "../swipe-step-area";
import { tint, useColors } from "../theme";
import { TEXT } from "./text";

const RANGES = [7, 30, 90] as const;
const kg = (value: number, language: KitchenLanguage) => value.toFixed(1).replace(".", language === "de" ? "," : ".");

/** Weigh-ins of the last 90 days: today's weight, the line, and each reading. A weight is logged for today. */
export function WeightPage({ snapshot }: { snapshot: BodyshopAppSnapshot }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const wide = useContentLayout().panes > 1;
  const [notice, setNotice] = useState<Notice | null>(null);
  const [open, setOpen] = useState<WeightReading>();
  const { days } = weightSummary(snapshot.history);
  const readings = [...(snapshot.history ?? [])].reverse();
  const dayName = (day: string) => day === snapshot.today ? text.today : `${dayParts(day, language).weekday} ${dayParts(day, language).dayMonth}`;
  const log = <LogWeight today={snapshot.today} current={days.at(-1)?.day === snapshot.today ? days.at(-1)!.kg : undefined} notify={setNotice} />;
  const list = readings.length ? (
    <View style={{ gap: 4 }}>
      <T weight="semibold" style={{ fontSize: 18 }}>{text.weighIns}</T>
      {readings.map((one) => (
        <Press key={one.id} accessibilityRole="button" onPress={() => setOpen(one)}
          style={({ pressed }) => [styles.row, { borderBottomColor: colors.border, backgroundColor: pressed ? colors.muted : "transparent" }]}>
          <View style={{ flex: 1 }}>
            <T>{[dayName(one.day), one.time ?? ""].filter(Boolean).join(", ")}</T>
            {one.external ? <T muted style={{ fontSize: 13 }}>Health Connect · {one.external.sourceApp}</T> : null}
          </View>
          <T weight="medium" muted={one.source === "Estimated"}>{kg(one.kg, language)} kg</T>
        </Press>
      ))}
    </View>
  ) : <Empty title={text.noWeighIns} body={text.noWeighInsBody} />;

  return (
    <Screen fullWidth={wide} title={text.weight} floating={<Snackbar notice={notice} onUndo={() => undefined} onDone={() => setNotice(null)} />}>
      <View style={{ flexDirection: wide ? "row" : "column", gap: wide ? 32 : 16, alignItems: "flex-start" }}>
        <View style={[styles.column, wide ? { flex: 1 } : { width: "100%" }]}><WeightTrend days={days} today={snapshot.today} />{log}</View>
        <View style={[styles.column, wide ? { flex: 1 } : { width: "100%" }]}>{list}</View>
      </View>
      {open ? <ReadingSheet reading={open} title={`${kg(open.kg, language)} kg`} day={dayName(open.day)} onClose={() => setOpen(undefined)} notify={setNotice} /> : null}
    </Screen>
  );
}

function LogWeight({ today, current, notify }: { today: string; current?: number; notify: (notice: Notice) => void }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const { ink } = usePageColor();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const parsed = Number(value.replace(",", "."));

  async function save() {
    const result = await bodyStore.act({ type: "weight.log", day: today, kg: parsed });
    if (result.ok) { setValue(""); setError(undefined); notify({ message: text.weightSaved }); return; }
    setError(result.reason === "refused" ? result.message : result.reason === "offline" ? text.needsConnection : text.failed);
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.muted, borderColor: "transparent" }]}>
      <T weight="semibold" style={{ fontSize: 18 }}>{text.todayWeight}</T>
      {current === undefined ? <T muted>{text.noWeight}</T> : <T weight="medium" style={{ fontSize: 22, color: ink }}>{kg(current, language)} kg</T>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Field accessibilityLabel={text.weight} value={value} onChangeText={setValue} inputMode="decimal" placeholder={text.weightPlaceholder} style={{ width: 120 }} />
        <T muted>kg</T>
        <Button tone="outline" label={text.saveWeight} disabled={!(parsed >= 20 && parsed <= 400)} onPress={() => void save()} />
      </View>
      {error ? <T accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</T> : null}
    </View>
  );
}

export function WeightTrend({ days, today, period }: { days: readonly { day: string; kg: number }[]; today: string; period?: 7 | 30 | 90 }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const { ink, hue } = usePageColor();
  const [localRange, setRange] = useState<(typeof RANGES)[number]>(30);
  const range = period ?? localRange;
  const [showAverage, setShowAverage] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string>();
  const [width, setWidth] = useState(0);
  const height = 148;
  const pad = 8;
  const from = addDays(today, 1 - range);
  const visible = days.filter(({ day }) => day >= from && day <= today);
  const found = visible.findIndex(({ day }) => day === selectedDay);
  const index = found < 0 ? visible.length - 1 : found;
  const selected = visible[index];
  const first = visible[0];
  const latest = visible.at(-1);
  const change = first && latest && first !== latest ? latest.kg - first.kg : undefined;
  const average = rollingWeightAverages(days).filter(({ day }) => day >= from && day <= today);
  const values = [...visible, ...(showAverage && visible.length > 1 ? average : [])].map(({ kg }) => kg);
  const dailyValues = visible.map(({ kg }) => kg);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const increment = Math.max(0.5, Math.ceil((high - low) * 0.5 + 0.1));
  const middle = (low + high) / 2;
  const levels = [middle + increment, middle, middle - increment];
  const plotWidth = Math.max(1, width - 2 * pad);
  const point = (one: { day: string; kg: number }) => ({
    x: pad + daysBetween(from, one.day) / (range - 1) * plotWidth,
    y: pad + (levels[0]! - one.kg) / (2 * increment) * (height - 2 * pad),
  });
  const points = visible.map(point);
  const active = points[index];
  const selectedAverage = average.find(({ day }) => day === selected?.day);
  const moveSelection = (step: -1 | 1) => {
    const next = visible[index + step];
    if (!next) return false;
    setSelectedDay(next.day);
    return true;
  };
  const line = points.map(({ x, y }) => `${x},${y}`).join(" ");

  const averageLine = average.map(point).map(({ x, y }) => `${x},${y}`).join(" ");

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <T accessibilityRole="header" weight="semibold" style={{ fontSize: 18 }}>{text.weightTrend}</T>
      {period === undefined ? <View accessibilityRole="radiogroup" style={[styles.ranges, { backgroundColor: colors.muted }]}>
        {RANGES.map((days) => (
          <Press key={days} accessibilityRole="radio" accessibilityState={{ selected: range === days }}
            onPress={() => { setRange(days); setSelectedDay(undefined); }}
            style={[styles.range, range === days && { backgroundColor: hue }]}>
            <T weight="medium" style={{ color: range === days ? "#fff" : colors.foreground }}>{text.trendDays(days)}</T>
          </Press>
        ))}
      </View> : null}
      {selected ? <>
        <View style={styles.trendHeader}>
          <View style={{ flex: 1, gap: 2 }} accessibilityLiveRegion="polite">
            <T weight="semibold" style={{ fontSize: 32 }}>{kg(selected.kg, language)} kg</T>
            <T muted>{text.dailyWeight(dayParts(selected.day, language).dayMonth)}</T>
          </View>
          <View style={styles.trendSteps}>
            {([[-1, ChevronLeft, text.previousReading], [1, ChevronRight, text.nextReading]] as const).map(([step, Icon, label]) => (
              <Press key={step} accessibilityRole="button" accessibilityLabel={label} disabled={!visible[index + step]}
                onPress={() => moveSelection(step)}
                style={[styles.trendStep, { borderColor: colors.border, opacity: visible[index + step] ? 1 : 0.4 }]}>
                <Icon size={18} color={colors.foreground} />
              </Press>
            ))}
          </View>
        </View>
        {visible.length > 1 ? <Press accessibilityRole="checkbox" accessibilityState={{ checked: showAverage }}
          onPress={() => setShowAverage(!showAverage)} style={styles.averageToggle}>
          <T weight="medium" style={{ color: showAverage ? colors.pageInk.kitchen : colors.mutedForeground }}>{showAverage ? "✓  " : "+  "}{text.rollingAverage}{showAverage && selectedAverage ? ` · ${kg(selectedAverage.kg, language)} kg` : ""}</T>
        </Press> : null}
        <SwipeStepArea onStep={moveSelection}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ justifyContent: "space-between", alignItems: "flex-end" }} importantForAccessibility="no-hide-descendants">
              {levels.map((level) => <T key={level} muted style={styles.axis}>{kg(level, language)}</T>)}
            </View>
            <Press style={{ flex: 1, height }} accessibilityRole="adjustable" accessibilityLabel={text.weightTrend}
              accessibilityValue={{ text: `${dayParts(selected.day, language).dayMonth}, ${kg(selected.kg, language)} kg` }}
              accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
              onAccessibilityAction={(event) => moveSelection(event.nativeEvent.actionName === "increment" ? 1 : -1)}
              onLayout={(event) => setWidth(event.nativeEvent.layout.width)} onPress={(event) => {
                const x = event.nativeEvent.locationX;
                const nearest = points.reduce((best, point, next) => Math.abs(point.x - x) < Math.abs(points[best]!.x - x) ? next : best, 0);
                setSelectedDay(visible[nearest]?.day);
              }}>
              <View pointerEvents="none">
                {width > 0 && active ? <Svg width={width} height={height}>
                  {[pad, height / 2, height - pad].map((y) => <Line key={y} x1={pad} x2={width - pad} y1={y} y2={y} stroke={colors.border} />)}
                  {points.length > 1 ? <>
                    <Polygon points={`${points[0]!.x},${height - pad} ${line} ${points.at(-1)!.x},${height - pad}`} fill={tint(ink, 12, colors.card)} />
                    <Polyline points={line} fill="none" stroke={ink} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                  </> : null}
                  {showAverage && points.length > 1 ? <Polyline points={averageLine} fill="none" stroke={colors.pageInk.kitchen} strokeWidth={2.5} strokeDasharray="5 4" strokeLinecap="round" /> : null}
                  <Line x1={active.x} x2={active.x} y1={pad} y2={height - pad} stroke={ink} strokeDasharray="3 4" />
                  <Circle cx={active.x} cy={active.y} r={5} fill={ink} stroke={colors.card} strokeWidth={2} />
                </Svg> : null}
              </View>
            </Press>
          </View>
        </SwipeStepArea>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <T muted style={styles.axis}>{dayParts(from, language).dayMonth}</T>
          <T muted style={styles.axis}>{dayParts(today, language).dayMonth}</T>
        </View>
        {change !== undefined && first && latest ? <T muted style={{ fontSize: 13 }}>
          {text.trendChange(`${change > 0 ? "+" : change < 0 ? "−" : ""}${kg(Math.abs(change), language)}`, dayParts(first.day, language).dayMonth, dayParts(latest.day, language).dayMonth)}
        </T> : null}
        <View style={[styles.weightStats, { borderTopColor: colors.border }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <T muted style={styles.axis}>{text.lowestWeight}</T>
            <T weight="semibold">{kg(Math.min(...dailyValues), language)} kg</T>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T muted style={styles.axis}>{text.highestWeight}</T>
            <T weight="semibold">{kg(Math.max(...dailyValues), language)} kg</T>
          </View>
        </View>
        <T muted style={styles.axis}>{text.weighInDays(visible.length, range)}</T>
      </> : <T muted>{text.noWeightsInRange}</T>}
    </View>
  );
}

function ReadingSheet({ reading, title, day, onClose, notify }: { reading: WeightReading; title: string; day: string; onClose: () => void; notify: (notice: Notice) => void }) {
  const text = useText(TEXT);
  const colors = useColors();
  const [error, setError] = useState<string>();

  async function remove() {
    const result = await bodyStore.act({ type: "remove", kind: "weight", id: reading.id });
    if (result.ok) { notify({ message: text.weightRemoved }); onClose(); return; }
    setError(result.reason === "refused" ? result.message : result.reason === "offline" ? text.needsConnection : text.failed);
  }

  return (
    <Sheet open onClose={onClose} title={title} description={[day, reading.time ?? ""].filter(Boolean).join(", ")}
      footer={<View style={{ width: "100%", flexDirection: "row", justifyContent: "flex-end" }}><Button tone="destructive" label={text.remove} onPress={() => void remove()} /></View>}>
      {reading.notes ? <T muted>{reading.notes}</T> : null}
      {error ? <T accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</T> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 16, borderRadius: 16, borderWidth: 1 },
  ranges: { flexDirection: "row", borderRadius: 12, padding: 4, gap: 4 },
  range: { flex: 1, minHeight: 44, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  trendHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  trendSteps: { flexDirection: "row", gap: 8 },
  trendStep: { width: 44, height: 44, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  averageToggle: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
  weightStats: { flexDirection: "row", gap: 12, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12 },
  axis: { fontSize: 12, fontVariant: ["tabular-nums"] },
  column: { gap: 16, maxWidth: 720 },
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 4, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
});
