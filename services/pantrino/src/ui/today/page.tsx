import { addDays } from "@tools-platform/service/kitchen-contract";
import { router, useFocusEffect } from "expo-router";
import { Check, ChevronRight, Flame } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { bodyStore, useBody } from "../../body/store";
import { type OpenKitchen, useApp } from "../../state";
import { LogSheet } from "../body/log-sheet";
import { TEXT as BODY_TEXT } from "../body/text";
import { LeftoverRow } from "../home/leftover-row";
import { AddLeftoverSheet } from "../home/sheets";
import { Button, dayParts, type Notice, PlateRing, Press, Screen, Snackbar, T } from "../kit";
import { useLanguage, useText } from "../language";
import { tint, useColors } from "../theme";
import { cookUndo } from "../week/cook";
import { EntrySheet, MealMenu, PlanSheet } from "../week/sheets";
import { TEXT as WEEK_TEXT } from "../week/text";
import { todayView } from "./model";
import { TEXT } from "./text";

type Selection = { kind: "plan" } | { kind: "entry" | "menu"; id: string } | { kind: "leftover"; name: string } | { kind: "log" };

export function Today({ data }: { data: OpenKitchen }) {
  const view = useMemo(() => todayView(data.kitchen, data.today), [data.kitchen, data.today]);
  const text = useText(TEXT);
  const weekText = useText(WEEK_TEXT);
  const bodyText = useText(BODY_TEXT);
  const language = useLanguage();
  const colors = useColors();
  const { session } = useApp();
  const body = useBody();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const tonight = view.tonight;
  const selectedEntry = selection && (selection.kind === "entry" || selection.kind === "menu") ? data.kitchen.plan.find((one) => one.id === selection.id) : undefined;
  const bodySnapshot = session === "signed-in" && body.status !== "unknown" && body.status !== "no-access" ? body.snapshot : null;
  useFocusEffect(useCallback(() => {
    if (bodySnapshot && bodySnapshot.day !== data.today) void bodyStore.refresh(data.today);
  }, [session, bodySnapshot?.day, data.today]));
  const bodyToday = bodySnapshot?.day === data.today ? bodySnapshot : null;
  const kcal = Math.round(bodyToday?.entries.reduce((sum, one) => sum + (one.nutrients.kcal ?? 0), 0) ?? 0);
  const date = dayParts(data.today, language);
  const tomorrow = dayParts(addDays(data.today, 1), language);
  const close = () => setSelection(null);
  const leftovers = (name: string) => setSelection({ kind: "leftover", name });
  function cook() {
    if (!tonight) return;
    data.change({ type: "plan.cook", id: tonight.entry.id });
    setNotice({ message: weekText.cookedTaken, undo: cookUndo(data.kitchen, tonight.entry), action: { label: text.leftovers, run: () => leftovers(tonight.entry.recipe) } });
  }
  return <Screen title={text.title} facts={`${date.weekdayLong} ${date.dayMonth}`}
    floating={<Snackbar notice={notice} onUndo={data.change} onDone={() => setNotice(null)} />}>
    <View style={[styles.card, { backgroundColor: tint(colors.pageInk.today, 10, colors.background) }]}>
      <T weight="semibold" style={{ color: colors.pageInk.today }}>{text.tonight}{tonight ? ` · ${weekText.meals[tonight.entry.meal]}` : ""}</T>
      {tonight ? <>
        <Press accessibilityRole="button" accessibilityLabel={tonight.entry.recipe} accessibilityHint={weekText.openRecipe}
          onPress={() => router.push({ pathname: "/kitchen/[recipeId]", params: { recipeId: tonight.entry.recipeId } })}
          onLongPress={() => setSelection({ kind: "menu", id: tonight.entry.id })} style={styles.row}>
          <PlateRing groups={data.kitchen.kitchen.groups} sections={tonight.sections} size={56} />
          <View style={{ flex: 1, gap: 4 }}>
            <T weight="semibold" style={{ fontSize: 24 }}>{tonight.entry.recipe}</T>
            <T muted style={{ fontSize: 14 }}>{[weekText.servings(tonight.entry.servings), tonight.minutes ? weekText.minutes(tonight.minutes) : "", tonight.kcal !== null ? `${tonight.kcal} kcal` : ""].filter(Boolean).join(" · ")}</T>
          </View>
        </Press>
        <View style={styles.actions}>
          <Button label={text.cooked} icon={Check} onPress={cook} />
          <Button label={text.recipe} tone="outline" onPress={() => router.push({ pathname: "/kitchen/[recipeId]", params: { recipeId: tonight.entry.recipeId } })} />
          <Button label={text.change} tone="outline" onPress={() => setSelection({ kind: "entry", id: tonight.entry.id })} />
        </View>
      </> : <><T muted>{text.noDinner}</T><Button label={text.planDinner} onPress={() => setSelection({ kind: "plan" })} /></>}
    </View>
    <View style={{ gap: 8 }}>
      <T weight="semibold" style={{ fontSize: 18 }}>{text.useFirst}</T>
      {view.leftovers.length ? view.leftovers.map((one) => <LeftoverRow key={`${one.id}:${one.servings}`} leftover={one} today={data.today} change={data.change} notify={setNotice} />) : <T muted>{text.noLeftovers}</T>}
    </View>
    <Press accessibilityRole="button" onPress={() => router.navigate({ pathname: "/shopping", params: { week: view.shopping.start } })}
      style={[styles.card, styles.row, { backgroundColor: tint(colors.pageInk.shopping, 10, colors.background) }]}>
      <PlateRing groups={data.kitchen.kitchen.groups} sections={view.shopping.toBuy.map((one) => one.section)} size={36} />
      <View style={{ flex: 1, gap: 4 }}><T weight="semibold" style={{ color: colors.pageInk.shopping, fontSize: 18 }}>{text.toBuy(view.shopping.count)}</T><T muted>{view.shopping.count ? text.more(view.buyNames, view.shopping.count) : text.allBought}</T></View>
      <ChevronRight size={20} color={colors.mutedForeground} />
    </Press>
    {bodySnapshot ? <View style={[styles.card, { backgroundColor: tint(colors.nutrient.kcal, 10, colors.background) }]}>
      <Press accessibilityRole="button" onPress={() => { void bodyStore.refresh(data.today); router.push("/bodyshop"); }} style={styles.row}>
        <Flame size={28} color={colors.nutrient.kcal} />
        <View style={{ flex: 1, gap: 4 }}><T weight="semibold" style={{ fontSize: 18 }}>{bodyToday ? bodyText.ofTarget(kcal, bodyToday.targets.kcal) : bodyText.loading}</T><T muted>Bodyshop</T></View>
      </Press>
      <Button label={bodyText.logFood} tone="outline" onPress={() => setSelection({ kind: "log" })} />
    </View> : null}
    <View style={{ gap: 8 }}>
      <View style={[styles.row, { justifyContent: "space-between", flexWrap: "wrap" }]}><T weight="semibold" style={{ fontSize: 18 }}>{text.tomorrow}</T><T muted>{`${tomorrow.weekday} ${tomorrow.number}`}</T></View>
      {view.tomorrow.length ? view.tomorrow.map((one) => <Press key={one.entry.id} accessibilityRole="button" onPress={() => setSelection({ kind: "entry", id: one.entry.id })} style={[styles.card, styles.row, { backgroundColor: colors.card }]}>
        <PlateRing groups={data.kitchen.kitchen.groups} sections={one.sections} size={30} />
        <View style={{ flex: 1, gap: 3 }}><T muted style={{ fontSize: 13 }}>{weekText.meals[one.entry.meal]}</T><T weight="medium">{one.entry.recipe}</T></View>
      </Press>) : <T muted>{text.noTomorrow}</T>}
    </View>
    {selection?.kind === "plan" ? <PlanSheet data={data} week={view.week} day={data.today} meal="dinner" onClose={close} notify={setNotice} /> : null}
    {selectedEntry && selection?.kind === "entry" ? <EntrySheet data={data} week={view.week} entry={selectedEntry} onClose={close} notify={setNotice} /> : null}
    {selectedEntry && selection?.kind === "menu" ? <MealMenu data={data} week={view.week} entry={selectedEntry} onClose={close} notify={setNotice} onLeftovers={leftovers} /> : null}
    {selection?.kind === "leftover" ? <AddLeftoverSheet {...data} initialName={selection.name} onClose={close} /> : null}
    {selection?.kind === "log" ? <LogSheet day={data.today} onClose={close} notify={setNotice} /> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 12, borderRadius: 16, minHeight: 48 },
  row: { flexDirection: "row", gap: 12, alignItems: "center", minHeight: 48 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
