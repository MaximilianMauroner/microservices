import { addDays, type BodyshopAppSnapshot, daysBetween, type WeightReading } from "@tools-platform/service/bodyshop-contract";
import { formatNumber } from "@tools-platform/service/kitchen-contract";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";
import { bodyStore } from "../../body/store";
import { weightSummary } from "../../body/weight";
import { Button, dayParts, Empty, Field, type Notice, Press, Screen, Sheet, Snackbar, T, usePageColor } from "../kit";
import { type KitchenLanguage, useLanguage, useText } from "../language";
import { useContentLayout } from "../responsive";
import { useColors } from "../theme";
import { TEXT } from "./text";

const CHART_DAYS = 90;
const kg = (value: number, language: KitchenLanguage) => formatNumber(Math.round(value * 10) / 10, language);

/** Weigh-ins of the last 90 days: today's weight, the line, and each reading. A weight is logged for today. */
export function WeightPage({ snapshot }: { snapshot: BodyshopAppSnapshot }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const wide = useContentLayout().panes > 1;
  const [notice, setNotice] = useState<Notice | null>(null);
  const [open, setOpen] = useState<WeightReading>();
  const { days, latest, change } = weightSummary(snapshot.history);
  const readings = [...(snapshot.history ?? [])].reverse();
  const dayName = (day: string) => day === snapshot.today ? text.today : `${dayParts(day, language).weekday} ${dayParts(day, language).dayMonth}`;
  const facts = latest ? [`${kg(latest.kg, language)} kg`, change ? text.weightChange(`${change.kg > 0 ? "+" : change.kg < 0 ? "−" : "±"}${kg(Math.abs(change.kg), language)}`, dayName(change.since)) : ""].filter(Boolean).join(" · ") : undefined;

  const log = <LogWeight today={snapshot.today} current={days.at(-1)?.day === snapshot.today ? days.at(-1)!.kg : undefined} notify={setNotice} />;
  const line = days.length ? (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <T weight="semibold" style={{ fontSize: 18 }}>{text.lastDays}</T>
      <Line days={days} today={snapshot.today} />
    </View>
  ) : null;
  const list = readings.length ? (
    <View style={{ gap: 4 }}>
      <T weight="semibold" style={{ fontSize: 18 }}>{text.weighIns}</T>
      {readings.map((one) => (
        <Press key={one.id} accessibilityRole="button" onPress={() => setOpen(one)}
          style={({ pressed }) => [styles.row, { borderBottomColor: colors.border, backgroundColor: pressed ? colors.muted : "transparent" }]}>
          <T style={{ flex: 1 }}>{[dayName(one.day), one.time ?? ""].filter(Boolean).join(", ")}</T>
          <T weight="medium" muted={one.source === "Estimated"}>{kg(one.kg, language)} kg</T>
        </Press>
      ))}
    </View>
  ) : <Empty title={text.noWeighIns} body={text.noWeighInsBody} />;

  return (
    <Screen fullWidth={wide} title={text.weight} facts={facts} floating={<Snackbar notice={notice} onUndo={() => undefined} onDone={() => setNotice(null)} />}>
      <View style={{ flexDirection: wide ? "row" : "column", gap: wide ? 32 : 16, alignItems: "flex-start" }}>
        <View style={[styles.column, wide ? { flex: 1 } : { width: "100%" }]}>{log}{line}</View>
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

/** The daily means across the last 90 days, with the lowest and highest weight beside it. */
function Line({ days, today }: { days: readonly { day: string; kg: number }[]; today: string }) {
  const language = useLanguage();
  const colors = useColors();
  const { ink } = usePageColor();
  const [width, setWidth] = useState(0);
  const height = 140;
  const from = addDays(today, 1 - CHART_DAYS);
  const values = days.map((one) => one.kg);
  const [low, high] = [Math.min(...values), Math.max(...values)];
  const span = Math.max(high - low, 1);
  const pad = 8;
  const point = (one: { day: string; kg: number }) => [
    pad + (daysBetween(from, one.day) / (CHART_DAYS - 1)) * (width - 2 * pad),
    pad + ((high - one.kg) / span) * (height - 2 * pad),
  ] as const;
  const points = days.map(point);
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <View style={{ justifyContent: "space-between", paddingVertical: 2 }}>
        <T muted style={{ fontSize: 12 }}>{kg(high, language)}</T>
        <T muted style={{ fontSize: 12 }}>{kg(low, language)}</T>
      </View>
      <View style={{ flex: 1, height }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        accessible accessibilityRole="image" accessibilityLabel={`${kg(low, language)}–${kg(high, language)} kg`}>
        {width ? <Svg width={width} height={height}>
          <Polyline points={points.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke={ink} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          {points.map(([x, y], index) => <Circle key={days[index]!.day} cx={x} cy={y} r={3} fill={ink} stroke={colors.card} strokeWidth={1.5} />)}
        </Svg> : null}
      </View>
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
  column: { gap: 16, maxWidth: 720 },
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 4, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
});
