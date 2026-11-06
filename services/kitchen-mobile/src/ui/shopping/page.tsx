import { addDays, formatAmount, weekStart } from "@tools-platform/service/kitchen-contract";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Plus } from "lucide-react-native";
import { useLocalSearchParams } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Pressable, type ScrollViewInstance, StyleSheet, View } from "react-native";
import type { OpenKitchen } from "../../state";
import {
  Button,
  Empty,
  FloatingButton,
  GroupDot,
  GroupLabel,
  GroupList,
  type Notice,
  PlateRing,
  Screen,
  Snackbar,
  T,
  byGroup,
  groupLabel,
  weekLabel,
} from "../kit";
import { useLanguage, useText } from "../language";
import { groupColor, ink, tint, useColors } from "../theme";
import { ListRow } from "./row";
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
  const scroll = useRef<ScrollViewInstance>(null);
  const positions = useRef(new Map<string, number>());
  const contentTop = useRef(0);
  const shopping = shoppingView(kitchen, week);
  const groups = byGroup(kitchen.kitchen.groups, shopping.toBuy, (line) => line.section);
  function run({ action, ...notice }: RowChange) {
    change(action);
    setNotice(notice);
  }
  const facts = `${weekLabel(week, today, language)}. ${shopping.count ? text.toBuy(shopping.count) : text.nothingToBuy}${shopping.plannedMeals ? ` ${text.plannedFor(shopping.plannedMeals)}` : ""}.`;
  return (
    <Screen
      ref={scroll}
      title={text.title}
      facts={facts}
      floating={
        <>
          <Snackbar notice={notice} onUndo={change} onDone={() => setNotice(null)} />
          <FloatingButton icon={Plus} label={text.add} onPress={() => setAdding(true)} />
        </>
      }
      actions={
        <>
          <Button
            icon={ChevronLeft}
            tone="outline"
            accessibilityLabel={text.previousWeek}
            disabled={addDays(week, -7) < planFrom}
            onPress={() => setWeek(addDays(week, -7))}
          />
          <Button
            icon={ChevronRight}
            tone="outline"
            accessibilityLabel={text.nextWeek}
            onPress={() => setWeek(addDays(week, 7))}
          />
        </>
      }
    >
      <View
        onLayout={(event) => {
          contentTop.current = event.nativeEvent.layout.y;
        }}
        style={{ gap: 24 }}
      >
        {groups.length ? (
          <View
            accessibilityLabel={text.groupsOnList}
            style={[styles.balance, { backgroundColor: tint(colors.pageInk.shopping, 10, colors.card) }]}
          >
            <PlateRing
              groups={kitchen.kitchen.groups}
              sections={shopping.toBuy.map((line) => line.section)}
              size={64}
            />
            <View style={[styles.wrap, { flex: 1 }]}>
              {groups.map(([section, lines]) => (
                <Pressable
                  key={section}
                  accessibilityRole="button"
                  onPress={() =>
                    scroll.current?.scrollTo({
                      y: contentTop.current + (positions.current.get(section) ?? 0),
                      animated: true,
                    })
                  }
                  style={styles.jump}
                >
                  <GroupDot groups={kitchen.kitchen.groups} group={section} />
                  <T
                    weight="semibold"
                    style={{ color: ink(groupColor(colors, kitchen.kitchen.groups, section), colors), flexShrink: 1 }}
                  >
                    {groupLabel(section, language)} {lines.length}
                  </T>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        {!shopping.count && !shopping.covered.length ? <Empty title={text.emptyTitle} body={text.emptyBody} /> : null}
        {shopping.weekly.length ? (
          <Group
            title={text.everyWeek}
            color={colors.pageInk.home}
            count={shopping.weekly.filter((extra) => !extra.bought).length}
          >
            {shopping.weekly.map((extra) => (
              <ListRow
                key={`${week}:${extra.id}:${extra.bought}`}
                row={{ kind: "weekly", extra, week: shopping.start }}
                color={colors.pageInk.home}
                onChange={run}
              />
            ))}
          </Group>
        ) : null}
        {shopping.once.length ? (
          <Group title={text.alsoBuy} color={colors.pageInk.shopping}>
            {shopping.once.map((extra) => (
              <ListRow key={extra.id} row={{ kind: "once", extra }} color={colors.pageInk.shopping} onChange={run} />
            ))}
          </Group>
        ) : null}
        {groups.map(([section, lines]) => (
          <View
            key={section}
            onLayout={(event) => {
              positions.current.set(section, event.nativeEvent.layout.y);
            }}
          >
            <Group
              title={groupLabel(section, language)}
              color={groupColor(colors, kitchen.kitchen.groups, section)}
              count={lines.length}
            >
              {lines.map((line) => (
                <ListRow
                  key={`${line.ingredientId}:${line.inStock}:${line.toBuy}`}
                  row={{ kind: "line", line }}
                  color={groupColor(colors, kitchen.kitchen.groups, section)}
                  onChange={run}
                />
              ))}
            </Group>
          </View>
        ))}
        {shopping.covered.length ? (
          <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 12, gap: 8 }}>
            <Pressable
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
            </Pressable>
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
            run(rowChanges({ kind: "weekly", extra: { ...extra, bought: false }, week: shopping.start }, text, language).remove!)
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
  balance: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 16 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  jump: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6 },
  covered: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
});
