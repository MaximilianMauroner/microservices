import { addDays, weekStart } from "@tools-platform/service/kitchen-contract";
import { router } from "expo-router";
import { Check, ChevronLeft, ChevronRight, Plus, ShoppingBasket } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { OpenKitchen } from "../../state";
import type { QueuedAction } from "../../sync/model";
import { Button, dayParts, mainGroup, PlateRing, Screen, T, useByLabel, usePageColor, weekLabel, weekRange } from "../kit";
import { useLanguage, useText } from "../language";
import { groupColor, tint, useColors } from "../theme";
import { buildWeek } from "./model";
import { EntrySheet, PlanSheet } from "./sheets";
import { TEXT } from "./text";

type Selection = { kind: "plan"; day: string } | { kind: "entry"; id: string };
export type Notice = { message: string; undo?: QueuedAction };

export function Week({ data }: { data: OpenKitchen }) {
  const { kitchen: snapshot, today, planFrom, change } = data;
  const { kitchen } = snapshot;
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const page = usePageColor();
  const [requested, setRequested] = useState(() => weekStart(today));
  const [selection, setSelection] = useState<Selection | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const week = useMemo(() => buildWeek(snapshot, requested, planFrom), [snapshot, requested, planFrom]);
  const recipes = new Map(week.recipes.map((recipe) => [recipe.id, recipe]));
  const title = weekLabel(week.start, today, language);
  const range = weekRange(week.start, language);
  const entry = selection?.kind === "entry" ? week.entries.find((one) => one.id === selection.id) : undefined;
  const close = () => setSelection(null);

  return (
    <Screen title={title}
      facts={`${title === range ? "" : `${range} · `}${week.entries.length ? text.plannedFacts(week.entries.length, week.cooked) : text.nothingPlanned}`}
      actions={<>
        <Button icon={ChevronLeft} tone="outline" accessibilityLabel={text.previousWeek} disabled={!week.canGoBack} onPress={() => setRequested(addDays(week.start, -7))} />
        <Button label={text.today} tone="outline" disabled={week.days.some((one) => one.day === today)} onPress={() => setRequested(weekStart(today))} />
        <Button icon={ChevronRight} tone="outline" accessibilityLabel={text.nextWeek} onPress={() => setRequested(addDays(week.start, 7))} />
      </>}>
      {week.canGoBack ? null : <T muted style={styles.small}>{text.historyLimit}</T>}
      {notice ? (
        <View style={[styles.notice, { backgroundColor: colors.muted }]}>
          <T accessibilityLiveRegion="polite" style={{ flex: 1 }}>{notice.message}</T>
          {notice.undo ? <Button label={text.undo} tone="ghost" onPress={() => { if (notice.undo) change(notice.undo); setNotice(null); }} /> : null}
        </View>
      ) : null}
      <View accessibilityLabel={text.daysOfWeek} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
        {week.days.map(({ day, entries }) => {
          const parts = dayParts(day, language);
          const isToday = day === today;
          const past = day < today;
          return (
            <View key={day} style={[styles.day, { borderBottomColor: colors.border }, isToday && { backgroundColor: tint(page.hue, 7, colors.background), borderRadius: 16 }]}>
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
                    <Pressable key={one.id} accessibilityRole="button" onPress={() => setSelection({ kind: "entry", id: one.id })}
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
                    </Pressable>
                  );
                })}
                {past && !entries.length ? <T muted style={{ minHeight: 64, paddingTop: 22 }}>{text.nothingPlannedDay}</T> : (
                  <Pressable accessibilityRole="button" accessibilityLabel={entries.length ? text.planAnother(parts.weekdayLong, parts.dayMonth) : text.planMeal(parts.weekdayLong, parts.dayMonth)}
                    onPress={() => setSelection({ kind: "plan", day })}
                    style={[styles.add, { borderColor: entries.length ? "transparent" : colors.border, alignSelf: entries.length ? "flex-start" : "stretch" }]}>
                    <Plus size={16} color={colors.mutedForeground} /><T muted style={{ fontSize: 14 }}>{entries.length ? text.add : text.planAMeal}</T>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
      </View>
      <View accessibilityLabel={text.glance} style={{ gap: 12 }}>
        <Pressable accessibilityRole="button" onPress={() => router.navigate({ pathname: "/shopping", params: { week: week.start } })}
          style={[styles.shopping, { backgroundColor: tint(colors.pageInk.shopping, 10, colors.background) }]}>
          {week.buySections.length ? <PlateRing groups={kitchen.groups} sections={week.buySections} size={60} /> : (
            <View style={[styles.basket, { backgroundColor: tint(colors.pageInk.shopping, 16, colors.background) }]}><ShoppingBasket size={24} color={colors.pageInk.shopping} /></View>
          )}
          <View style={{ flex: 1, gap: 4 }}>
            <T weight="semibold" style={{ fontSize: 18, color: colors.pageInk.shopping }}>{week.toBuy ? text.toBuy(week.toBuy) : text.nothingToBuy}</T>
            <T muted style={styles.small}>{text.notCookedYet}</T>
          </View>
        </Pressable>
        <View style={[styles.leftovers, { backgroundColor: week.leftovers.some((one) => useByLabel(one.useBy, today, language).urgent) ? tint(colors.destructive, 7, colors.background) : colors.muted }]}>
          <T weight="semibold" style={{ fontSize: 18 }}>{text.useFirst}</T>
          {week.leftovers.length ? week.leftovers.slice(0, 5).map((one) => {
            const label = useByLabel(one.useBy, today, language);
            return <View key={one.id} style={{ gap: 3 }}><T weight="medium">{one.name}</T><T style={[styles.small, { color: label.urgent ? colors.destructive : colors.mutedForeground }]}>{text.servings(one.servings)}. {label.text}</T></View>;
          }) : <T muted style={styles.small}>{text.noLeftovers}</T>}
          <Button label={text.openAtHome} tone="ghost" onPress={() => router.navigate("/home")} />
        </View>
      </View>
      {selection?.kind === "plan" ? <PlanSheet key={selection.day} day={selection.day} data={data} week={week} onClose={close} notify={setNotice} /> : null}
      {entry ? <EntrySheet key={entry.id} entry={entry} data={data} week={week} onClose={close} notify={setNotice} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  small: { fontSize: 12 },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, padding: 12 },
  day: { flexDirection: "row", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
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
