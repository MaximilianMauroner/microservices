import { addDays, type Meal, weekStart } from "@tools-platform/service/kitchen-contract";
import { Check, Plus } from "lucide-react-native";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { type OpenKitchen } from "../../state";
import { Button, dayParts, FloatingButton, mainGroup, PlateRing, Pane, Press, Screen, Snackbar, T, type Notice, usePageColor, weekLabel, StepNav, weekRange } from "../kit";
import { haptic } from "../haptics";
import { useLanguage, useText } from "../language";
import { groupColor, tint, useColors } from "../theme";
import { useContentLayout, Workspace } from "../responsive";
import { buildWeek, swipeStep } from "./model";
import { AddLeftoverSheet } from "../home/sheets";
import { EntrySheet, MealMenu, PlanSheet } from "./sheets";
import { TEXT } from "./text";

type Selection = { kind: "plan"; day?: string; meal?: Meal } | { kind: "entry" | "menu"; id: string } | { kind: "leftover"; name: string };

/** Touches this close to the side of the day list do not start a week swipe, so the system back gesture keeps working. */
const EDGE = 24;

export function Week({ data }: { data: OpenKitchen }) {
  const { kitchen: snapshot, today, planFrom, change } = data;
  const { kitchen } = snapshot;
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const page = usePageColor();
  const wide = useContentLayout().panes > 1;
  const [requested, setRequested] = useState(() => weekStart(today));
  const [selection, setSelection] = useState<Selection | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const week = useMemo(() => buildWeek(snapshot, requested, planFrom), [snapshot, requested, planFrom]);
  const recipes = new Map(week.recipes.map((recipe) => [recipe.id, recipe]));
  const title = weekLabel(week.start, today, language);
  const range = weekRange(week.start, language);
  const entry = selection?.kind === "entry" || selection?.kind === "menu" ? week.entries.find((one) => one.id === selection.id) : undefined;
  const close = () => setSelection(null);
  const show = (start: string) => {
    setRequested(start);
    setSelection((open) => open?.kind === "plan" ? { kind: "plan" } : open);
  };
  const turn = (step: -1 | 0 | 1) => {
    const moves = step === 1 || (step === -1 && week.canGoBack);
    if (moves) show(addDays(week.start, 7 * step));
    return moves;
  };
  const release = (translationX: number, velocityX: number) => { if (turn(swipeStep(translationX, velocityX))) haptic("toggle"); };
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

  const detail = selection?.kind === "plan" ? <PlanSheet key={`${week.start}/${selection.day ?? "next"}/${selection.meal ?? "auto"}`} presentation={wide ? "pane" : "sheet"} day={selection.day} meal={selection.meal} data={data} week={week} onClose={close} notify={setNotice} />
    : entry && selection?.kind === "entry" ? <EntrySheet key={entry.id} presentation={wide ? "pane" : "sheet"} entry={entry} data={data} onClose={close} notify={setNotice} />
    : wide ? <Pane title={text.planAMeal}><T muted>{text.pickDay}</T></Pane> : null;
  return (
    <Workspace detail={detail} onBack={selection?.kind === "plan" || selection?.kind === "entry" ? close : undefined}>
      <Screen title={title}
        facts={`${title === range ? "" : `${range}\u00a0· `}${week.entries.length ? text.plannedFacts(week.entries.length, week.cooked) : text.nothingPlanned}`}
        floating={<Snackbar notice={notice} onUndo={change} onDone={() => setNotice(null)} />}
        fab={<FloatingButton icon={Plus} label={text.plan} onPress={() => setSelection({ kind: "plan" })} />}
        actions={<>
          {week.days.some((one) => one.day === today) ? null : <Button label={text.today} tone="outline" onPress={() => show(weekStart(today))} />}
          <StepNav canGoBack={week.canGoBack} onStep={turn} />
        </>}>
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
                <View key={day} style={[styles.day, { borderBottomColor: colors.border, paddingVertical: past ? 0 : 12 }]}>
                  <View style={[styles.date, past && { minHeight: 48, justifyContent: "center", paddingTop: 0 }]}>
                    {past ? <T muted style={{ fontSize: 13 }}>{`${parts.weekday} ${parts.number}`}</T> : <>
                    <T weight={isToday ? "semibold" : "medium"} numberOfLines={1} adjustsFontSizeToFit style={[styles.small, { color: isToday ? page.ink : colors.mutedForeground }]}>{isToday ? text.today : parts.weekday}</T>
                    <View style={[styles.number, isToday && { backgroundColor: page.hue }]}>
                      <T weight="medium" style={{ fontSize: 26, color: isToday ? "#ffffff" : past ? colors.mutedForeground : colors.foreground }}>{parts.number}</T>
                    </View>
                    </>}
                  </View>
                  <View style={{ gap: 8, flex: 1 }}>
                    {entries.map((one) => {
                      const recipe = recipes.get(one.recipeId);
                      const group = mainGroup(kitchen.groups, recipe?.sections ?? []);
                      const background = group ? tint(groupColor(colors, kitchen.groups, group), 16, colors.card) : colors.muted;
                      const open = () => setSelection({ kind: "entry", id: one.id });
                      if (past) return <Press key={one.id} accessibilityRole="button" onPress={open}
                        onLongPress={() => { haptic("hold"); setSelection({ kind: "menu", id: one.id }); }}
                        style={{ flexDirection: "row", alignItems: "center", minHeight: 48, gap: 8 }}>
                        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: group ? groupColor(colors, kitchen.groups, group) : colors.mutedForeground }} />
                        <T muted style={{ flex: 1, fontSize: 14 }}>{one.recipe}</T>
                        {one.cooked ? <Check size={16} color={colors.mutedForeground} accessibilityLabel={text.cooked} /> : null}
                      </Press>;
                      return (
                        <Press key={one.id} accessibilityRole="button" onPress={() => setSelection({ kind: "entry", id: one.id })}
                          onLongPress={() => { haptic("hold"); setSelection({ kind: "menu", id: one.id }); }}
                          accessibilityActions={[{ name: "longpress", label: text.mealActions }]}
                          onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === "longpress") setSelection({ kind: "menu", id: one.id }); }}
                          style={({ pressed }) => [styles.meal, { backgroundColor: one.cooked ? "transparent" : background, borderColor: one.cooked ? colors.border : "transparent", opacity: pressed ? 0.75 : 1 }]}>
                          <View style={{ opacity: one.cooked ? 0.4 : 1, paddingTop: 2 }}><PlateRing groups={kitchen.groups} sections={recipe?.sections ?? []} size={22} /></View>
                          <View style={{ flex: 1, gap: 3 }}>
                            <View style={styles.mealTop}>
                              <T muted style={styles.small}>{text.meals[one.meal]}</T>
                              {one.cooked ? <View style={styles.cooked}><Check size={14} color={colors.foreground} /><T weight="medium" style={styles.small}>{text.cooked}</T></View> : null}
                            </View>
                            <T weight="medium" muted={one.cooked} style={{ fontSize: 16 }}>{one.recipe}</T>
                            <T muted style={styles.small}>{text.servings(one.servings)}{recipe?.kcal ? text.kcalEach(recipe.kcal) : ""}</T>
                          </View>
                        </Press>
                      );
                    })}
                    {!entries.length && !past ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {(["lunch", "dinner"] as const).map((meal) => <Button key={meal} tone="outline" compact icon={Plus} label={text.meals[meal]}
                        accessibilityLabel={`${text.planMeal(parts.weekdayLong, parts.dayMonth)}, ${text.meals[meal]}`}
                        onPress={() => setSelection({ kind: "plan", day, meal })} />)}
                    </View> : null}
                  </View>
                </View>
              );
            })}
          </Animated.View>
        </GestureDetector>
        {selection?.kind === "leftover" ? <AddLeftoverSheet {...data} initialName={selection.name} onClose={close} /> : null}
        {entry && selection?.kind === "menu" ? <MealMenu onLeftovers={(name) => setSelection({ kind: "leftover", name })} key={entry.id} entry={entry} data={data} onClose={close} notify={setNotice} /> : null}
      </Screen>
    </Workspace>
  );
}

const styles = StyleSheet.create({
  small: { fontSize: 12 },
  day: { flexDirection: "row", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  pastDay: { minHeight: 48, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  date: { width: 52, alignItems: "center", gap: 4, paddingTop: 4 },
  number: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  meal: { minHeight: 64, flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: 12, padding: 8 },
  mealTop: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 4 },
  cooked: { flexDirection: "row", alignItems: "center", gap: 4 },
});
