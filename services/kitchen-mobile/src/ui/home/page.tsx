import { formatAmount, type StockItem } from "@tools-platform/service/kitchen-contract";
import { Check, Info, Plus, Trash2, Utensils } from "lucide-react-native";
import { useRef, useState } from "react";
import Animated, { FadeOut } from "react-native-reanimated";
import { StyleSheet, View } from "react-native";
import type { OpenKitchen } from "../../state";
import type { QueuedAction } from "../../sync/model";
import { Button, Empty, FloatingButton, groupLabel, GroupLabel, GroupList, LIST_MOTION, Press, Screen, Snackbar, T, type Notice, useByLabel } from "../kit";
import { useLanguage, useText } from "../language";
import { groupColor, tint, useColors } from "../theme";
import { IngredientSheet } from "../ingredients/ingredient-sheet";
import { RowMenu, type SwipeAction, SwipeRow } from "../swipe-row";
import { AddLeftoverSheet, AddStockSheet, AmountSheet } from "./sheets";
import { TEXT } from "./text";
import { pantryShelves } from "./view";

type OpenSheet = { type: "stock" } | { type: "leftover" } | { type: "ingredient"; id: string } | { type: "amount"; id: string };
type Run = (action: QueuedAction, title: string, undo?: QueuedAction) => void;

export function Pantry(data: OpenKitchen) {
  const { kitchen, today, change } = data;
  const text = useText(TEXT);
  const language = useLanguage();
  const colors = useColors();
  const [sheet, setSheet] = useState<OpenSheet>();
  const [notice, setNotice] = useState<Notice | null>(null);
  const leftovers = [...kitchen.leftovers].sort((a, b) => a.useBy.localeCompare(b.useBy));
  const run: Run = (action, title, undo) => {
    change(action);
    setNotice({ message: title, undo: undo && [undo] });
  };
  const viewing = sheet?.type === "ingredient" ? kitchen.ingredients.find((one) => one.id === sheet.id) : undefined;
  const sizing = sheet?.type === "amount" ? kitchen.stock.find((one) => one.ingredientId === sheet.id) : undefined;
  return (
    <Screen
      title={text.title}
      facts={`${text.inStock(kitchen.stock.length)}${leftovers.length ? text.toUseFirst(leftovers.length) : ""}`}
      floating={<Snackbar notice={notice} onUndo={change} onDone={() => setNotice(null)} />}
      fab={<FloatingButton icon={Plus} label={text.addToStock} onPress={() => setSheet({ type: "stock" })} />}
    >
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <T weight="semibold" accessibilityRole="header" style={{ fontSize: 18 }}>
            {text.useFirst}
          </T>
          <Button tone="outline" icon={Utensils} label={text.addLeftover} onPress={() => setSheet({ type: "leftover" })} />
        </View>
        {leftovers.length ? (
          leftovers.map((leftover) => {
            const label = useByLabel(leftover.useBy, today, language);
            const back: QueuedAction = { type: "leftover.add", name: leftover.name, servings: leftover.servings, useBy: leftover.useBy };
            const eat = () => run({ type: "leftover.eat", id: leftover.id, servings: Math.min(1, leftover.servings) }, text.ate(leftover.name), leftover.servings <= 1 ? back : undefined);
            const remove = () => run({ type: "leftover.remove", id: leftover.id }, text.thrownAway(leftover.name), back);
            return (
              <Animated.View key={leftover.id} layout={LIST_MOTION} exiting={FadeOut.duration(140)} style={{ borderRadius: 16, overflow: "hidden" }}>
                <SwipeRow key={leftover.servings}
                  right={{ label: text.ateOne, icon: Check, color: colors.pageInk.home, run: eat }}
                  left={{ label: text.throwAway, icon: Trash2, color: colors.destructive, run: remove }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingLeft: 14, paddingRight: 4, backgroundColor: colors.card }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <T weight="medium">{leftover.name}<T muted style={{ fontSize: 13 }}>{`  ${text.servings(leftover.servings)}`}</T></T>
                      <T style={{ fontSize: 13, color: label.urgent ? colors.destructive : colors.mutedForeground }}>{label.text}</T>
                    </View>
                    <EatButton onEat={eat} />
                    <RowMenu name={leftover.name} actions={[{ label: text.throwAway, icon: Trash2, color: colors.destructive, run: remove }]} />
                  </View>
                </SwipeRow>
              </Animated.View>
            );
          })
        ) : (
          <View
            style={{ borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, borderRadius: 16, padding: 20 }}
          >
            <T muted style={{ fontSize: 14 }}>
              {text.noLeftovers}
            </T>
          </View>
        )}
      </View>
      <View accessibilityLabel={text.stock} style={{ gap: 16 }}>
        {!kitchen.stock.length ? <Empty title={text.nothingInStock} body={text.checkItems} /> : null}
        {pantryShelves(kitchen).filter(({ items }) => items.length).map(({ section, items }) => {
          const color = groupColor(colors, kitchen.kitchen.groups, section);
          return (
            <View key={section}>
              <GroupLabel color={color} count={items.length}>
                {groupLabel(section, language)}
              </GroupLabel>
              <GroupList color={color}>
                {items.map((item) => (
                  <StockRow
                    key={item.ingredientId}
                    item={item}
                    background={tint(color, 11, colors.card)}
                    run={run}
                    onAmount={() => setSheet({ type: "amount", id: item.ingredientId })}
                    onOpen={() => setSheet({ type: "ingredient", id: item.ingredientId })}
                  />
                ))}
              </GroupList>
            </View>
          );
        })}
      </View>
      {sheet?.type === "stock" ? (
        <AddStockSheet {...data} onClose={() => setSheet(undefined)} />
      ) : null}
      {sheet?.type === "leftover" ? <AddLeftoverSheet {...data} onClose={() => setSheet(undefined)} /> : null}
      {sizing ? (
        <AmountSheet key={sizing.ingredientId} item={sizing} onClose={() => setSheet(undefined)}
          onSave={(amount) => run({ type: "stock.set", ingredientId: sizing.ingredientId, amount }, text.updated(sizing.ingredient), { type: "stock.set", ingredientId: sizing.ingredientId, amount: sizing.amount })} />
      ) : null}
      {viewing ? (
        <IngredientSheet key={viewing.id} kitchen={kitchen} change={data.change} existing={viewing} newName="" onClose={() => setSheet(undefined)} />
      ) : null}
    </Screen>
  );
}

function EatButton({ onEat }: { onEat: () => void }) {
  const text = useText(TEXT);
  const [pending, setPending] = useState(false);
  const acted = useRef(false);
  return (
    <Button tone="outline" icon={Check} label={text.ateOne} disabled={pending} onPress={() => {
      if (acted.current) return;
      acted.current = true;
      setPending(true);
      onEat();
    }} />
  );
}

function StockRow({ item, background, run, onAmount, onOpen }: { item: StockItem; background: string; run: Run; onAmount: () => void; onOpen: () => void }) {
  const language = useLanguage();
  const colors = useColors();
  const text = useText(TEXT);
  const usedUp = () =>
    run({ type: "stock.set", ingredientId: item.ingredientId, amount: 0 }, text.usedUpToast(item.ingredient), {
      type: "stock.set",
      ingredientId: item.ingredientId,
      amount: item.amount,
    });
  const used: SwipeAction = { label: text.usedUp, icon: Check, color: colors.pageInk.home, run: usedUp };
  const details: SwipeAction = { label: text.details, icon: Info, color: colors.foreground, run: onOpen };
  return (
    <SwipeRow right={used}>
      <View style={[styles.line, { backgroundColor: background }]}>
        <Press
          accessibilityRole="button"
          accessibilityLabel={`${item.ingredient}, ${formatAmount(item.amount, item.unit, language)}`}
          accessibilityHint={text.amountOf(item.ingredient)}
          accessibilityActions={[{ name: "usedUp", label: text.usedUpAria(item.ingredient) }]}
          onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === "usedUp") usedUp(); }}
          onPress={onAmount}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
        >
          <T weight="medium" style={{ flex: 1 }}>{item.ingredient}</T>
          <T weight="semibold" style={{ fontSize: 15 }}>{formatAmount(item.amount, item.unit, language)}</T>
        </Press>
        <RowMenu name={item.ingredient} actions={[used, details]} />
      </View>
    </SwipeRow>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", paddingRight: 4 },
  row: { flex: 1, minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 14, paddingVertical: 8 },
});
