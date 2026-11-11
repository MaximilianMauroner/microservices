import { router } from "expo-router";
import { addDays, type BodyshopAppSnapshot, MEALS } from "@tools-platform/service/bodyshop-contract";
import { formatNumber } from "@tools-platform/service/kitchen-contract";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { bodyStore } from "../../body/store";
import { Button, useKitText, dayParts, Empty, Field, FloatingButton, type Notice, Press, Screen, Sheet, Snackbar, T } from "../kit";
import { useLanguage, useText } from "../language";
import { tint, useColors } from "../theme";
import { LogSheet, unitLabel } from "./log-sheet";
import { TEXT } from "./text";

type Entry = BodyshopAppSnapshot["entries"][number];

/** One Bodyshop day: what is eaten against the targets, the food by meal, and the weight. */
export function Today({ snapshot }: { snapshot: BodyshopAppSnapshot }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const kitText = useKitText();
  const colors = useColors();
  const [logging, setLogging] = useState(false);
  const [entry, setEntry] = useState<Entry>();
  const [notice, setNotice] = useState<Notice | null>(null);
  const { day, today, targets, entries } = snapshot;
  const eaten = (key: "kcal" | "protein" | "carbs" | "fat" | "fiber") => entries.reduce((sum, one) => sum + (one.nutrients[key] ?? 0), 0);
  const kcal = Math.round(eaten("kcal"));
  const title = day === today ? text.today : day === addDays(today, -1) ? text.yesterday : `${dayParts(day, language).weekdayLong} ${dayParts(day, language).dayMonth}`;
  const go = (step: -1 | 1) => void bodyStore.refresh(addDays(day, step));

  return (
    <Screen title={title} back={{ label: kitText.back, onPress: () => router.back() }} facts={text.ofTarget(kcal, targets.kcal)}
      floating={<Snackbar notice={notice} onUndo={() => undefined} onDone={() => setNotice(null)} />}
      fab={<FloatingButton icon={Plus} label={text.logFood} onPress={() => setLogging(true)} />}
      actions={<>
        {day === today ? null : <Button tone="outline" label={text.today} onPress={() => void bodyStore.refresh(today)} />}
        <Button tone="ghost" icon={ChevronLeft} accessibilityLabel={text.previousDay} onPress={() => go(-1)} />
        <Button tone="ghost" icon={ChevronRight} accessibilityLabel={text.nextDay} disabled={day >= today} onPress={() => go(1)} />
      </>}>
      <Button tone="outline" label={text.foods} onPress={() => router.push("/bodyshop/foods")} />
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <T weight="semibold" style={{ fontSize: 28, color: kcal > targets.kcal ? colors.destructive : colors.foreground }}>
          {kcal > targets.kcal ? text.over(kcal - targets.kcal) : text.left(targets.kcal - kcal)}
        </T>
        <Bar share={kcal / targets.kcal} color={colors.nutrient.kcal} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {(["protein", "carbs", "fat", "fiber"] as const).map((key) => (
            <View key={key} style={{ flexGrow: 1, flexBasis: 130, gap: 4 }}>
              <T muted style={{ fontSize: 12 }}>{text.nutrients[key]}</T>
              <T weight="medium">{formatNumber(Math.round(eaten(key)), language)} / {targets[key]} g</T>
              <Bar share={eaten(key) / targets[key]} color={colors.nutrient[key]} />
            </View>
          ))}
        </View>
        {entries.some((one) => one.check !== "Ready") ? <T muted style={{ fontSize: 12 }}>{text.checks}</T> : null}
      </View>
      {entries.length ? MEALS.filter((meal) => entries.some((one) => one.meal === meal)).map((meal) => {
        const rows = entries.filter((one) => one.meal === meal);
        return (
          <View key={meal} style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <T weight="semibold" style={{ fontSize: 18 }}>{text.meals[meal]}</T>
              <T muted>{formatNumber(Math.round(rows.reduce((sum, one) => sum + (one.nutrients.kcal ?? 0), 0)), language)} {text.kcal}</T>
            </View>
            {rows.map((one) => (
              <Press key={one.id} accessibilityRole="button" onPress={() => setEntry(one)}
                style={({ pressed }) => [styles.entry, { borderBottomColor: colors.border, backgroundColor: pressed ? colors.muted : "transparent" }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T>{one.food}</T>
                  <T muted style={{ fontSize: 12 }}>{one.amount === null ? "" : `${formatNumber(one.amount, language)} ${unitLabel(one.unit, language, one.amount)}`}</T>
                </View>
                <T weight="medium">{one.nutrients.kcal === null ? "?" : formatNumber(Math.round(one.nutrients.kcal), language)}</T>
              </Press>
            ))}
          </View>
        );
      }) : <Empty title={text.nothingLogged} body={text.nothingLoggedBody} />}
      <Weight snapshot={snapshot} notify={setNotice} />
      {logging ? <LogSheet day={day} onClose={() => setLogging(false)} notify={setNotice} /> : null}
      {entry ? <EntrySheet entry={entry} onClose={() => setEntry(undefined)} notify={setNotice} /> : null}
    </Screen>
  );
}

function Bar({ share, color }: { share: number; color: string }) {
  const colors = useColors();
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: tint(color, 18, colors.background), overflow: "hidden" }}>
      <View style={{ width: `${Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0)) * 100}%`, height: "100%", borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

function Weight({ snapshot, notify }: { snapshot: BodyshopAppSnapshot; notify: (notice: Notice) => void }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const [kg, setKg] = useState("");
  const [error, setError] = useState<string>();
  const latest = snapshot.weights.at(-1);
  const value = Number(kg.replace(",", "."));

  async function save() {
    const result = await bodyStore.act({ type: "weight.log", day: snapshot.day, kg: value });
    if (result.ok) { setKg(""); setError(undefined); notify({ message: text.weightSaved }); return; }
    setError(result.reason === "refused" ? result.message : result.reason === "offline" ? text.needsConnection : text.failed);
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.muted, borderColor: "transparent" }]}>
      <T weight="semibold" style={{ fontSize: 18 }}>{text.weight}</T>
      {latest ? <T weight="medium" style={{ fontSize: 22, color: colors.nutrient.protein }}>{text.weightToday(formatNumber(latest.kg, language))}</T> : <T muted>{text.noWeight}</T>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Field accessibilityLabel={text.weight} value={kg} onChangeText={setKg} inputMode="decimal" placeholder={text.weightPlaceholder} style={{ width: 120 }} />
        <T muted>kg</T>
        <Button tone="outline" label={text.saveWeight} disabled={!(value >= 20 && value <= 400)} onPress={() => void save()} />
      </View>
      {error ? <T accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</T> : null}
    </View>
  );
}

/** One logged food, with its values. A correction of amounts stays on the web; the phone can remove an entry. */
function EntrySheet({ entry, onClose, notify }: { entry: Entry; onClose: () => void; notify: (notice: Notice) => void }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const [error, setError] = useState<string>();

  async function remove() {
    const result = await bodyStore.act({ type: "remove", kind: "entry", id: entry.id });
    if (result.ok) { notify({ message: text.removed(entry.food) }); onClose(); return; }
    setError(result.reason === "refused" ? result.message : result.reason === "offline" ? text.needsConnection : text.failed);
  }

  return (
    <Sheet open onClose={onClose} title={entry.food} description={`${text.meals[entry.meal]}${entry.amount === null ? "" : `, ${formatNumber(entry.amount, language)} ${unitLabel(entry.unit, language, entry.amount)}`}`}
      footer={<View style={{ width: "100%", flexDirection: "row", justifyContent: "flex-end" }}><Button tone="destructive" label={text.remove} onPress={() => void remove()} /></View>}>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {(["kcal", "protein", "carbs", "fat", "fiber"] as const).map((key) => (
          <View key={key} style={{ flex: 1, alignItems: "center", gap: 2 }}>
            <T muted style={{ fontSize: 11, textAlign: "center" }}>{text.nutrients[key]}</T>
            <T weight="semibold" style={{ color: colors.nutrient[key] }}>{entry.nutrients[key] === null ? "?" : formatNumber(Math.round(entry.nutrients[key]!), language)}</T>
          </View>
        ))}
      </View>
      {entry.notes ? <T muted>{entry.notes}</T> : null}
      {error ? <T accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</T> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 16, borderRadius: 16, borderWidth: 1 },
  entry: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 4, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
});
