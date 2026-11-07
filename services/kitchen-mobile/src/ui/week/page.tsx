import { addDays, weekStart } from "@tools-platform/service/kitchen-contract";
import { router } from "expo-router";
import { Check, Plus, ShoppingBasket } from "lucide-react-native";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSync, type OpenKitchen } from "../../state";
import { Button, dayParts, FloatingButton, mainGroup, PlateRing, Press, Screen, Snackbar, T, type Notice, useByLabel, usePageColor, weekLabel, WeekNav, weekRange } from "../kit";
import { haptic } from "../haptics";
import { useLanguage, useText } from "../language";
import { groupColor, tint, useColors } from "../theme";
import { buildWeek, swipeStep } from "./model";
import { EntrySheet, MealMenu, PlanSheet } from "./sheets";
import { useLocalText } from "../local-mode";
import { TEXT } from "./text";

type Selection = { kind: "plan"; day?: string } | { kind: "entry" | "menu"; id: string };

/** Touches this close to the side of the day list do not start a week swipe, so the system back gesture keeps working. */
const EDGE = 24;

export function Week({ data }: { data: OpenKitchen }) {
  const { kitchen: snapshot, today, planFrom, change } = data;
  const { kitchen } = snapshot;
  const language = useLanguage();
  const text = useText(TEXT);
  const localText = useLocalText();
  const { mode } = useSync();
  const colors = useColors();
  const page = usePageColor();
  const [requested, setRequested] = useState(() => weekStart(today));
  const [selection, setSelection] = useState<Selection | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const week = useMemo(() => buildWeek(snapshot, requested, planFrom), [snapshot, requested, planFrom]);
  const recipes = new Map(week.recipes.map((recipe) => [recipe.id, recipe]));
  const title = weekLabel(week.start, today, language);
  const range = weekRange(week.start, language);
  const entry = selection && selection.kind !== "plan" ? week.entries.find((one) => one.id === selection.id) : undefined;
  const close = () => setSelection(null);
  const turn = (step: -1 | 0 | 1) => {
    if (step === 1 || (step === -1 && week.canGoBack)) setRequested(addDays(week.start, 7 * step));
  };
  const release = (translationX: number, velocityX: number) => turn(swipeStep(translationX, velocityX));
  const shift = useSharedValue(0);
  const swipe = usePanGesture({
    activeOffsetX: [-24, 24],
    failOffsetY: [-12, 12],
    hitSlop: { left: -EDGE, right: -EDGE },
    onUpdate: (event) => { shift.value = Math.max(-48, Math.min(48, event.translationX / 4)); },
    onDeactivate: (event) => { if (!event.canceled) scheduleOnRN(release, event.translationX, event.velocityX); },
    onFinalize: () => { shift.value = withTiming(0, { duration: 160 }); },
  });
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: shift.value }] }));

  return (
    <Screen title={title}
      facts={`${title === range ? "" : `${range} · `}${week.entries.length ? text.plannedFacts(week.entries.length, week.cooked) : text.nothingPlanned}`}
      floating={<Snackbar notice={notice} onUndo={change} onDone={() => setNotice(null)} />}
      fab={<FloatingButton icon={Plus} label={text.plan} onPress={() => setSelection({ kind: "plan" })} />}
      actions={<>
        {week.days.some((one) => one.day === today) ? null : <Button label={text.today} tone="outline" onPress={() => setRequested(weekStart(today))} />}
        <WeekNav canGoBack={week.canGoBack} onStep={turn} />
      </>}>
      {week.canGoBack ? null : <T muted style={styles.small}>{mode === "local" ? localText.history : text.historyLimit}</T>}
      <GestureDetector gesture={swipe}>
        <Animated.View accessibilityLabel={text.daysOfWeek}
          accessibilityActions={[{ name: "next", label: text.nextWeek }, ...(week.canGoBack ? [{ name: "previous", label: text.previousWeek }] : [])]}
          onAccessibilityAction={(event) => turn(event.nativeEvent.actionName === "next" ? 1 : -1)}
          style={[{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border }, slide]}>
          {week.days.map(({ day, entries }, index) => {
            const parts = dayParts(day, language);
            const isToday = day === today;
            const past = day < today;
            const quiet = (at: number) => { const one = week.days[at]; return one !== undefined && one.day < today && !one.entries.length; };
            if (quiet(index)) {
              if (quiet(index - 1)) return null;
              let last = index;
              while (quiet(last + 1)) last += 1;
              const end = dayParts(week.days[last]!.day, language);
              return (
                <View key={day} style={[styles.pastDay, { borderBottomColor: colors.border }]}>
                  <T muted style={{ fontSize: 14 }}>{last === index ? `${parts.weekday} ${parts.number}` : text.pastDays(`${parts.weekday} ${parts.number}`, `${end.weekday} ${end.number}`)}</T>
                  <T muted style={{ fontSize: 14 }}>{text.nothingPlannedDay}</T>
                </View>
              );
            }
            return (
              <View key={day} style={[styles.day, { borderBottomColor: colors.border }]}>
                <View style={styles.date}>
                  <T weight={isToday ? "semibold" : "medium"} style={[styles.small, { color: isToday ? page.ink : colors.mutedForeground }]}>{isToday ? text.today : parts.weekday}</T>
                  <View style={[styles.number, isToday && { backgroundColor: page.hue }]}>
                    <T weight="medium" style={{ fontSize: 26, color: isToday ? "#ffffff" : past ? colors.mutedForeground : colors.foreground }}>{parts.number}</T>
                  </View>
                </View>
                <View style={{ flex: 1, gap: 8 }}>
                  {entries.map((one) => {
                    const recipe = recipes.get(one.recipeId);
                    const group = mainGroup(kitchen.groups, recipe?.sections ?? []);
                    const background = group ? tint(groupColor(colors, kitchen.groups, group), 16, colors.card) : colors.muted;
                    return (
                      <Press key={one.id} accessibilityRole="button" onPress={() => setSelection({ kind: "entry", id: one.id })}
                        onLongPress={() => { haptic("hold"); setSelection({ kind: "menu", id: one.id }); }}
                        accessibilityActions={[{ name: "longpress", label: text.mealActions }]}
                        onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === "longpress") setSelection({ kind: "menu", id: one.id }); }}
                        style={({ pressed }) => [styles.meal, { backgroundColor: one.cooked ? "transparent" : background, borderColor: one.cooked ? colors.border : "transparent", opacity: pressed ? 0.75 : 1 }]}>
                        <View style={{ opacity: one.cooked ? 0.4 : 1, paddingTop: 2 }}><PlateRing groups={kitchen.groups} sections={recipe?.sections ?? []} size={34} /></View>
                        <View style={{ flex: 1, gap: 3 }}>
                          <View style={styles.mealTop}>
                            <T muted style={styles.small}>{text.meals[one.meal]}</T>
                            {one.cooked ? <View style={styles.cooked}><Check size={14} color={colors.foreground} /><T weight="medium" style={styles.small}>{text.cooked}</T></View> : null}
                          </View>
                          <T weight="medium" muted={one.cooked} style={{ fontSize: 17 }}>{one.recipe}</T>
                          <T muted style={styles.small}>{text.servings(one.servings)}{recipe?.kcal ? text.kcalEach(recipe.kcal) : ""}</T>
                        </View>
                      </Press>
                    );
                  })}
                  {entries.length ? null : (
                    <Press accessibilityRole="button" accessibilityLabel={text.planMeal(parts.weekdayLong, parts.dayMonth)}
                      onPress={() => setSelection({ kind: "plan", day })} style={[styles.add, { borderColor: colors.border }]}>
                      <Plus size={16} color={colors.mutedForeground} /><T muted style={{ fontSize: 14 }}>{text.planAMeal}</T>
                    </Press>
                  )}
                </View>
              </View>
            );
          })}
        </Animated.View>
      </GestureDetector>
      <View accessibilityLabel={text.glance} style={{ gap: 12 }}>
        <Press accessibilityRole="button" onPress={() => router.navigate({ pathname: "/shopping", params: { week: week.start } })}
          style={[styles.shopping, { backgroundColor: tint(colors.pageInk.shopping, 10, colors.background) }]}>
          {week.buySections.length ? <PlateRing groups={kitchen.groups} sections={week.buySections} size={60} /> : (
            <View style={[styles.basket, { backgroundColor: tint(colors.pageInk.shopping, 16, colors.background) }]}><ShoppingBasket size={24} color={colors.pageInk.shopping} /></View>
          )}
          <View style={{ flex: 1, gap: 4 }}>
            <T weight="semibold" style={{ fontSize: 18, color: colors.pageInk.shopping }}>{week.toBuy ? text.toBuy(week.toBuy) : text.nothingToBuy}</T>
            <T muted style={styles.small}>{text.notCookedYet}</T>
          </View>
        </Press>
        <View style={[styles.leftovers, { backgroundColor: week.leftovers.some((one) => useByLabel(one.useBy, today, language).urgent) ? tint(colors.destructive, 7, colors.background) : colors.muted }]}>
          <T weight="semibold" style={{ fontSize: 18 }}>{text.useFirst}</T>
          {week.leftovers.length ? week.leftovers.slice(0, 5).map((one) => {
            const label = useByLabel(one.useBy, today, language);
            return <View key={one.id} style={{ gap: 3 }}><T weight="medium">{one.name}</T><T style={[styles.small, { color: label.urgent ? colors.destructive : colors.mutedForeground }]}>{text.servings(one.servings)}. {label.text}</T></View>;
          }) : <T muted style={styles.small}>{text.noLeftovers}</T>}
          <Button label={text.openAtHome} tone="ghost" onPress={() => router.navigate("/home")} />
        </View>
      </View>
      {selection?.kind === "plan" ? <PlanSheet key={selection.day ?? "next"} day={selection.day} data={data} week={week} onClose={close} notify={setNotice} /> : null}
      {entry && selection?.kind === "entry" ? <EntrySheet key={entry.id} entry={entry} data={data} week={week} onClose={close} notify={setNotice} /> : null}
      {entry && selection?.kind === "menu" ? <MealMenu key={entry.id} entry={entry} data={data} week={week} onClose={close} notify={setNotice} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  small: { fontSize: 12 },
  day: { flexDirection: "row", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  pastDay: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  date: { width: 52, alignItems: "center", gap: 4, paddingTop: 4 },
  number: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  meal: { minHeight: 64, flexDirection: "row", alignItems: "flex-start", gap: 12, borderWidth: 1, borderRadius: 12, padding: 10 },
  mealTop: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 4 },
  cooked: { flexDirection: "row", alignItems: "center", gap: 4 },
  add: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderStyle: "dashed", borderRadius: 12, paddingHorizontal: 12 },
  shopping: { flexDirection: "row", alignItems: "center", gap: 16, borderRadius: 16, padding: 16 },
  basket: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  leftovers: { gap: 10, borderRadius: 16, padding: 16 },
});
