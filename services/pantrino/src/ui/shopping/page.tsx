import * as Crypto from "expo-crypto";
import { addDays, formatAmount, weekStart } from "@tools-platform/service/kitchen-contract";
import { ChevronDown, ChevronUp, Plus } from "lucide-react-native";
import { useLocalSearchParams } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { StyleSheet, View } from "react-native";
import type { OpenKitchen } from "../../state";
import { Button, byGroup, Empty, FloatingButton, GroupDot, groupLabel, GroupLabel, GroupList, LIST_MOTION, Press, Screen, Snackbar, T, type Notice, weekLabel, WeekNav } from "../kit";
import { useLanguage, useText } from "../language";
import { groupColor, useColors } from "../theme";
import { ListRow } from "./row";
import { useSwipeTip } from "../swipe-row";
import { AddSheet } from "./sheet";
import { TEXT } from "./text";
import { type RowChange, rowChanges, shoppingView } from "./view";

export function Shopping({ kitchen, today, planFrom, change }: OpenKitchen) {
  const text = useText(TEXT);
  const language = useLanguage();
  const colors = useColors();
  const [week, setWeek] = useState(() => weekStart(today));
  const asked = useLocalSearchParams<{ week?: string }>().week;
  useEffect(() => { if (asked && asked >= planFrom) setWeek(weekStart(asked)); }, [asked, planFrom]);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const shopping = shoppingView(kitchen, week);
  const groups = byGroup(kitchen.kitchen.groups, shopping.toBuy, (line) => line.section);
  const tip = useSwipeTip();
  function run({ action, ...notice }: RowChange, tapped = false) {
    change(action);
    setNotice(tapped && tip.due() ? { ...notice, message: `${notice.message}. ${text.swipeTip}` } : notice);
  }
  const facts = `${weekLabel(week, today, language)}. ${shopping.count ? text.toBuy(shopping.count) : text.nothingToBuy}${shopping.plannedMeals ? ` ${text.plannedFor(shopping.plannedMeals)}` : ""}.`;
  return (
    <Screen
      title={text.title}
      facts={facts}
      floating={<Snackbar notice={notice} onUndo={change} onDone={() => setNotice(null)} />}
      fab={<FloatingButton icon={Plus} label={text.add} onPress={() => setAdding(true)} />}
      actions={
        <>
          {week === weekStart(today) ? null : <Button label={text.thisWeek} tone="outline" onPress={() => setWeek(weekStart(today))} />}
          <WeekNav canGoBack={addDays(week, -7) >= planFrom} onStep={(step) => setWeek(addDays(week, 7 * step))} />
        </>
      }
    >
      <View style={{ gap: 24 }}>
        {!shopping.count && !shopping.covered.length ? <Empty title={text.emptyTitle} body={text.emptyBody} /> : null}
        {shopping.weekly.length ? (
          <Group
            title={text.everyWeek}
            color={colors.pageInk.kitchen}
            count={shopping.weekly.filter((extra) => !extra.bought).length}
          >
            {shopping.weekly.map((extra) => (
              <ListRow
                key={extra.id}
                row={{ kind: "weekly", extra, week: shopping.start }}
                color={colors.pageInk.kitchen}
                onChange={run}
              />
            ))}
          </Group>
        ) : null}
        {shopping.once.length ? (
          <Group title={text.alsoBuy} color={colors.pageInk.shopping} count={shopping.once.length}>
            {shopping.once.map((extra) => (
              <ListRow key={extra.id} row={{ kind: "once", extra }} color={colors.pageInk.shopping} onChange={run} />
            ))}
          </Group>
        ) : null}
        {groups.map(([section, lines]) => (
          <Animated.View key={section} layout={LIST_MOTION} entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)}>
            <Group
              title={groupLabel(section, language)}
              color={groupColor(colors, kitchen.kitchen.groups, section)}
              count={lines.length}
            >
              {lines.map((line) => (
                <ListRow
                  key={line.ingredientId}
                  row={{ kind: "line", line }}
                  color={groupColor(colors, kitchen.kitchen.groups, section)}
                  onChange={run}
                />
              ))}
            </Group>
          </Animated.View>
        ))}
        {shopping.covered.length ? (
          <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 2 }}>
            <Press
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setExpanded(!expanded)}
              style={styles.covered}
            >
              <T muted weight="medium" style={{ flex: 1 }}>
                {text.alreadyAtHome(shopping.covered.length)}
              </T>
              {expanded ? (
                <ChevronUp color={colors.mutedForeground} size={18} />
              ) : (
                <ChevronDown color={colors.mutedForeground} size={18} />
              )}
            </Press>
            {expanded
              ? shopping.covered.map((line) => (
                  <View key={line.ingredientId} style={styles.covered}>
                    <GroupDot groups={kitchen.kitchen.groups} group={line.section} />
                    <T style={{ flex: 1 }}>{line.ingredient}</T>
                    <T muted style={{ fontSize: 13 }}>
                      {text.needs(formatAmount(line.needed, line.unit, language))}
                    </T>
                  </View>
                ))
              : null}
          </View>
        ) : null}
      </View>
      {adding ? (
        <AddSheet
          kitchen={kitchen}
          change={change}
          onRemove={(extra) =>
            run(rowChanges({ kind: "weekly", extra: { ...extra, bought: extra.boughtWeek === shopping.start }, week: shopping.start }, text, language, Crypto.randomUUID).remove!)
          }
          onClose={() => setAdding(false)}
        />
      ) : null}
    </Screen>
  );
}

function Group({
  title,
  color,
  count,
  children,
}: {
  title: string;
  color: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <View>
      <GroupLabel color={color} count={count}>
        {title}
      </GroupLabel>
      <GroupList color={color}>{children}</GroupList>
    </View>
  );
}

const styles = StyleSheet.create({
  covered: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 },
});
