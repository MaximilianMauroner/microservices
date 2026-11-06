import { addDays, formatAmount, weekStart } from "@tools-platform/service/kitchen-contract";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Plus, X } from "lucide-react-native";
import { useLocalSearchParams } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Pressable, type ScrollViewInstance, StyleSheet, View } from "react-native";
import type { OpenKitchen } from "../../state";
import type { QueuedAction } from "../../sync/model";
import {
  Button,
  Empty,
  GroupDot,
  GroupLabel,
  GroupList,
  PlateRing,
  Screen,
  T,
  byGroup,
  groupLabel,
  weekLabel,
} from "../kit";
import { useLanguage, useText } from "../language";
import { groupColor, ink, tint, useColors } from "../theme";
import { AddSheet } from "./sheet";
import { TEXT } from "./text";
import { shoppingView } from "./view";

const NOTICE_TEXT = {
  en: { undo: "Undo", dismiss: "Dismiss" },
  de: { undo: "Rückgängig", dismiss: "Schließen" },
};

export function Shopping({ kitchen, today, planFrom, change }: OpenKitchen) {
  const text = useText(TEXT);
  const noticeText = useText(NOTICE_TEXT);
  const language = useLanguage();
  const colors = useColors();
  const [week, setWeek] = useState(() => weekStart(today));
  const asked = useLocalSearchParams<{ week?: string }>().week;
  useEffect(() => { if (asked && asked >= planFrom) setWeek(weekStart(asked)); }, [asked, planFrom]);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [notice, setNotice] = useState<{ title: string; undo?: QueuedAction }>();
  const scroll = useRef<ScrollViewInstance>(null);
  const positions = useRef(new Map<string, number>());
  const contentTop = useRef(0);
  const shopping = shoppingView(kitchen, week);
  const groups = byGroup(kitchen.kitchen.groups, shopping.toBuy, (line) => line.section);
  function run(action: QueuedAction, title: string, undo?: QueuedAction) {
    change(action);
    setNotice({ title, undo });
  }
  const facts = `${weekLabel(week, today, language)}. ${shopping.count ? text.toBuy(shopping.count) : text.nothingToBuy}${shopping.plannedMeals ? ` ${text.plannedFor(shopping.plannedMeals)}` : ""}.`;
  return (
    <Screen
      ref={scroll}
      title={text.title}
      facts={facts}
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
          <Button icon={Plus} label={text.addItem} onPress={() => setAdding(true)} />
        </>
      }
    >
      <View
        onLayout={(event) => {
          contentTop.current = event.nativeEvent.layout.y;
        }}
        style={{ gap: 24 }}
      >
        {notice ? (
          <View accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: colors.muted }]}>
            <T style={{ flex: 1, fontSize: 14 }}>{notice.title}</T>
            {notice.undo ? (
              <Button
                compact
                tone="outline"
                label={noticeText.undo}
                onPress={() => {
                  change(notice.undo!);
                  setNotice(undefined);
                }}
              />
            ) : null}
            <Button
              compact
              tone="ghost"
              icon={X}
              accessibilityLabel={noticeText.dismiss}
              onPress={() => setNotice(undefined)}
            />
          </View>
        ) : null}
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
              <Row
                key={`${week}:${extra.id}:${extra.bought}`}
                name={extra.name}
                color={colors.pageInk.home}
                done={extra.bought}
                onCheck={() =>
                  run({ type: "extra.mark", id: extra.id, week, bought: true }, text.bought(extra.name), {
                    type: "extra.mark",
                    id: extra.id,
                    week,
                    bought: false,
                  })
                }
                onUncheck={() =>
                  run({ type: "extra.mark", id: extra.id, week, bought: false }, text.notBought(extra.name))
                }
              />
            ))}
          </Group>
        ) : null}
        {shopping.once.length ? (
          <Group title={text.alsoBuy} color={colors.pageInk.shopping}>
            {shopping.once.map((extra) => (
              <Row
                key={extra.id}
                name={extra.name}
                color={colors.pageInk.shopping}
                onCheck={() =>
                  run({ type: "extra.remove", id: extra.id }, text.bought(extra.name), {
                    type: "extra.add",
                    name: extra.name,
                  })
                }
              />
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
                <Row
                  key={`${line.ingredientId}:${line.inStock}:${line.toBuy}`}
                  name={line.ingredient}
                  color={groupColor(colors, kitchen.kitchen.groups, section)}
                  amount={formatAmount(line.toBuy, line.unit, language)}
                  detail={`${line.inStock ? `${text.inStock(formatAmount(line.inStock, line.unit, language))}. ` : ""}${text.forRecipes(line.recipes.join(", "))}`}
                  onCheck={() =>
                    run(
                      { type: "stock.add", ingredientId: line.ingredientId, amount: line.toBuy },
                      text.addedToHome(formatAmount(line.toBuy, line.unit, language), line.ingredient),
                      { type: "stock.set", ingredientId: line.ingredientId, amount: line.inStock },
                    )
                  }
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
            run({ type: "extra.remove", id: extra.id }, text.stopped(extra.name), {
              type: "extra.add",
              name: extra.name,
              everyWeek: true,
            })
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

function Row({
  name,
  amount,
  detail,
  color,
  done = false,
  onCheck,
  onUncheck,
}: {
  name: string;
  amount?: string;
  detail?: string;
  color: string;
  done?: boolean;
  onCheck: () => void;
  onUncheck?: () => void;
}) {
  const text = useText(TEXT);
  const colors = useColors();
  const [checked, setChecked] = useState(done);
  const tapped = useRef(false);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={text.boughtAria(name, amount)}
      accessibilityState={{ checked, disabled: checked && !onUncheck }}
      disabled={checked && !onUncheck}
      onPress={() => {
        if (tapped.current) return;
        tapped.current = true;
        setChecked(!checked);
        if (checked) onUncheck?.();
        else onCheck();
      }}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          borderWidth: 2,
          borderColor: color,
          backgroundColor: checked ? color : colors.card,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked ? <Check size={17} strokeWidth={3} color={colors.background} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <T
          weight="medium"
          style={checked ? { textDecorationLine: "line-through", color: colors.mutedForeground } : undefined}
        >
          {name}
        </T>
        {detail ? (
          <T muted style={{ fontSize: 12, marginTop: 2 }}>
            {detail}
          </T>
        ) : null}
      </View>
      {amount ? (
        <T weight="semibold" style={{ color: ink(color, colors), fontSize: 14 }}>
          {amount}
        </T>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12 },
  balance: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 16 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  jump: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6 },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  covered: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
});
