import type { KitchenSnapshot, StoredExtra } from "@tools-platform/service/kitchen-contract";
import { Check, Repeat, X } from "lucide-react-native";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import type { OpenKitchen } from "../../state";
import { Button, Field, GroupDot, Sheet, T, byGroup, groupLabel } from "../kit";
import { useLanguage, useText } from "../language";
import { useColors } from "../theme";
import { TEXT } from "./text";

export function AddSheet({
  kitchen,
  change,
  onRemove,
  onClose,
}: {
  kitchen: KitchenSnapshot;
  change: OpenKitchen["change"];
  onRemove: (extra: StoredExtra) => void;
  onClose: () => void;
}) {
  const text = useText(TEXT);
  const language = useLanguage();
  const colors = useColors();
  const [name, setName] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const [everyWeek, setEveryWeek] = useState(false);
  const addedNames = useRef(new Set<string>());
  const onList = new Set([
    ...kitchen.extras.map((extra) => extra.name.toLowerCase()),
    ...added.map((one) => one.toLowerCase()),
  ]);
  const weekly = kitchen.extras.filter((extra) => extra.everyWeek);
  function add(item: string) {
    const trimmed = item.trim().replace(/\s+/g, " ");
    if (
      !trimmed ||
      trimmed.length > 120 ||
      onList.has(trimmed.toLowerCase()) ||
      addedNames.current.has(trimmed.toLowerCase())
    )
      return;
    addedNames.current.add(trimmed.toLowerCase());
    change({ type: "extra.add", name: trimmed, everyWeek });
    setAdded((current) => [...current, trimmed]);
    setName("");
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={text.addTitle}
      description={text.addDescription}
      footer={<Button label={added.length ? text.doneAdded(added.length) : text.done} onPress={onClose} />}
    >
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Field
          style={{ flex: 1 }}
          value={name}
          onChangeText={setName}
          maxLength={120}
          accessibilityLabel={text.item}
          placeholder={text.itemPlaceholder}
          onSubmitEditing={() => add(name)}
          returnKeyType="done"
        />
        <Button
          label={text.add}
          tone="outline"
          disabled={!name.trim() || onList.has(name.trim().replace(/\s+/g, " ").toLowerCase())}
          onPress={() => add(name)}
        />
      </View>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Switch
            value={everyWeek}
            onValueChange={setEveryWeek}
            accessibilityLabel={text.addEveryWeek}
            trackColor={{ true: colors.page.shopping }}
          />
          <Repeat color={colors.mutedForeground} size={16} />
          <T weight="medium">{text.addEveryWeek}</T>
        </View>
        <T muted style={{ fontSize: 12 }}>
          {text.addEveryWeekHint}
        </T>
      </View>
      {weekly.length ? (
        <View style={{ gap: 8 }}>
          <T muted weight="semibold">
            {text.everyWeek}
          </T>
          <View style={styles.wrap}>
            {weekly.map((extra) => (
              <View key={extra.id} style={[styles.chip, { borderColor: colors.controlBorder }]}>
                <T style={{ flexShrink: 1 }}>{extra.name}</T>
                <Button
                  compact
                  tone="ghost"
                  icon={X}
                  accessibilityLabel={text.stopEveryWeek(extra.name)}
                  onPress={() => {
                    onRemove(extra);
                    addedNames.current.delete(extra.name.toLowerCase());
                    setAdded((current) => current.filter((one) => one.toLowerCase() !== extra.name.toLowerCase()));
                  }}
                />
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {byGroup(kitchen.kitchen.groups, kitchen.ingredients, (one) => one.section).map(([section, ingredients]) => (
        <View key={section} style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <GroupDot groups={kitchen.kitchen.groups} group={section} />
            <T muted weight="semibold" style={{ fontSize: 12 }}>
              {groupLabel(section, language)}
            </T>
          </View>
          <View style={styles.wrap}>
            {ingredients.map((ingredient) => {
              const isOn = onList.has(ingredient.name.toLowerCase());
              return (
                <Pressable
                  key={ingredient.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isOn, disabled: isOn }}
                  disabled={isOn}
                  onPress={() => add(ingredient.name)}
                  style={[
                    styles.chip,
                    {
                      minHeight: 44,
                      paddingHorizontal: 12,
                      backgroundColor: isOn ? colors.page.shopping : colors.control,
                      borderColor: isOn ? colors.page.shopping : colors.controlBorder,
                    },
                  ]}
                >
                  {isOn ? <Check color="#ffffff" size={16} /> : null}
                  <T style={{ color: isOn ? "#ffffff" : colors.foreground, flexShrink: 1 }}>{ingredient.name}</T>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      {!kitchen.ingredients.length ? <T muted>{text.quickPicks}</T> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 22,
    paddingLeft: 12,
    maxWidth: "100%",
  },
});
