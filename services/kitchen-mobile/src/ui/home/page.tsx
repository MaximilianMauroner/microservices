import { fieldNumber, type StockItem, unitName } from "@tools-platform/service/kitchen-contract";
import { Plus, Trash2, Utensils, X } from "lucide-react-native";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { OpenKitchen } from "../../state";
import type { QueuedAction } from "../../sync/model";
import { Button, Empty, Field, GroupLabel, GroupList, Screen, T, groupLabel, useByLabel } from "../kit";
import { useLanguage, useText } from "../language";
import { groupColor, tint, useColors } from "../theme";
import { IngredientSheet } from "../ingredients/ingredient-sheet";
import { AddLeftoverSheet, AddStockSheet } from "./sheets";
import { TEXT } from "./text";
import { pantryShelves, stockAmount } from "./view";

type OpenSheet = { type: "stock"; group?: string } | { type: "leftover" } | { type: "ingredient"; id: string };
type Run = (action: QueuedAction, title: string, undo?: QueuedAction) => void;
const NOTICE_TEXT = { en: { undo: "Undo", dismiss: "Dismiss" }, de: { undo: "Rückgängig", dismiss: "Schließen" } };

export function Pantry(data: OpenKitchen) {
  const { kitchen, today, change } = data;
  const text = useText(TEXT);
  const noticeText = useText(NOTICE_TEXT);
  const language = useLanguage();
  const colors = useColors();
  const [sheet, setSheet] = useState<OpenSheet>();
  const [notice, setNotice] = useState<{ title: string; undo?: QueuedAction }>();
  const leftovers = [...kitchen.leftovers].sort((a, b) => a.useBy.localeCompare(b.useBy));
  const run: Run = (action, title, undo) => {
    change(action);
    setNotice({ title, undo });
  };
  const viewing = sheet?.type === "ingredient" ? kitchen.ingredients.find((one) => one.id === sheet.id) : undefined;
  return (
    <Screen
      title={text.title}
      facts={`${text.inStock(kitchen.stock.length)}${leftovers.length ? text.toUseFirst(leftovers.length) : ""}`}
      actions={
        <>
          <Button
            tone="outline"
            icon={Utensils}
            label={text.addLeftover}
            onPress={() => setSheet({ type: "leftover" })}
          />
          <Button icon={Plus} label={text.addToStock} onPress={() => setSheet({ type: "stock" })} />
        </>
      }
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
      <View style={{ gap: 8 }}>
        <T weight="semibold" accessibilityRole="header" style={{ fontSize: 18 }}>
          {text.useFirst}
        </T>
        {leftovers.length ? (
          leftovers.map((leftover) => {
            const label = useByLabel(leftover.useBy, today, language);
            return (
              <View
                key={`${leftover.id}:${leftover.servings}`}
                style={{
                  padding: 14,
                  borderRadius: 16,
                  gap: 12,
                  backgroundColor: tint(label.urgent ? colors.destructive : colors.pageInk.home, 11, colors.card),
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <T weight="medium">{leftover.name}</T>
                    <T style={{ fontSize: 12, color: label.urgent ? colors.destructive : colors.mutedForeground }}>
                      {label.text}
                    </T>
                  </View>
                  <T weight="semibold" style={{ fontSize: 14 }}>
                    {text.servings(leftover.servings)}
                  </T>
                </View>
                <LeftoverActions
                  onEat={() =>
                    run(
                      { type: "leftover.eat", id: leftover.id, servings: Math.min(1, leftover.servings) },
                      text.ate(leftover.name),
                      leftover.servings <= 1
                        ? {
                            type: "leftover.add",
                            name: leftover.name,
                            servings: leftover.servings,
                            useBy: leftover.useBy,
                          }
                        : undefined,
                    )
                  }
                  onRemove={() =>
                    run({ type: "leftover.remove", id: leftover.id }, text.thrownAway(leftover.name), {
                      type: "leftover.add",
                      name: leftover.name,
                      servings: leftover.servings,
                      useBy: leftover.useBy,
                    })
                  }
                />
              </View>
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
        {pantryShelves(kitchen).map(({ section, items }) => {
          const color = groupColor(colors, kitchen.kitchen.groups, section);
          return (
            <View key={section}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ flexShrink: 1 }}>
                  <GroupLabel color={color} count={items.length}>
                    {groupLabel(section, language)}
                  </GroupLabel>
                </View>
                <Button
                  tone="ghost"
                  icon={Plus}
                  accessibilityLabel={text.addToGroup(groupLabel(section, language))}
                  onPress={() => setSheet({ type: "stock", group: section })}
                />
              </View>
              {items.length ? (
                <GroupList color={color}>
                  {items.map((item) => (
                    <StockRow
                      key={item.ingredientId}
                      item={item}
                      run={run}
                      onOpen={() => setSheet({ type: "ingredient", id: item.ingredientId })}
                    />
                  ))}
                </GroupList>
              ) : null}
            </View>
          );
        })}
      </View>
      {sheet?.type === "stock" ? (
        <AddStockSheet {...data} group={sheet.group} onClose={() => setSheet(undefined)} />
      ) : null}
      {sheet?.type === "leftover" ? <AddLeftoverSheet {...data} onClose={() => setSheet(undefined)} /> : null}
      {viewing ? (
        <IngredientSheet key={viewing.id} kitchen={kitchen} change={data.change} existing={viewing} newName="" onClose={() => setSheet(undefined)} />
      ) : null}
    </Screen>
  );
}

function LeftoverActions({ onEat, onRemove }: { onEat: () => void; onRemove: () => void }) {
  const text = useText(TEXT);
  const [pending, setPending] = useState(false);
  const acted = useRef(false);
  function act(action: () => void) {
    if (acted.current) return;
    acted.current = true;
    setPending(true);
    action();
  }
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Button tone="outline" label={text.eatOne} disabled={pending} onPress={() => act(onEat)} />
      <Button tone="destructive" label={text.throwAway} disabled={pending} onPress={() => act(onRemove)} />
    </View>
  );
}

function StockRow({ item, run, onOpen }: { item: StockItem; run: Run; onOpen: () => void }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const [value, setValue] = useState(fieldNumber(item.amount, language));
  const [source, setSource] = useState({ amount: item.amount, language });
  const committed = useRef(item.amount);
  if (source.amount !== item.amount || source.language !== language) {
    setSource({ amount: item.amount, language });
    setValue(fieldNumber(item.amount, language));
    committed.current = item.amount;
  }
  function commit() {
    const amount = stockAmount(value);
    if (amount === undefined) {
      setValue(fieldNumber(item.amount, language));
      return;
    }
    if (amount === committed.current) return;
    committed.current = amount;
    run({ type: "stock.set", ingredientId: item.ingredientId, amount }, text.updated(item.ingredient), {
      type: "stock.set",
      ingredientId: item.ingredientId,
      amount: item.amount,
    });
  }
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text.showIngredient(item.ingredient)}
        onPress={onOpen}
        style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
      >
        <T weight="medium">{item.ingredient}</T>
      </Pressable>
      <Field
        style={{ width: 76, textAlign: "right" }}
        value={value}
        onChangeText={setValue}
        keyboardType="decimal-pad"
        accessibilityLabel={text.amountOf(item.ingredient)}
        onBlur={commit}
        onSubmitEditing={commit}
        returnKeyType="done"
      />
      <T muted style={{ fontSize: 13, maxWidth: 48 }}>
        {unitName(item.unit, language, item.amount)}
      </T>
      <Button
        icon={Trash2}
        tone="ghost"
        accessibilityLabel={text.usedUpAria(item.ingredient)}
        onPress={() =>
          run({ type: "stock.set", ingredientId: item.ingredientId, amount: 0 }, text.usedUpToast(item.ingredient), {
            type: "stock.set",
            ingredientId: item.ingredientId,
            amount: item.amount,
          })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 12 },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
});
