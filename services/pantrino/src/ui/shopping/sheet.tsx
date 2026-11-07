import type { KitchenSnapshot, StoredExtra } from "@tools-platform/service/kitchen-contract";
import { ArrowUp, Check, Repeat, X } from "lucide-react-native";
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { OpenKitchen } from "../../state";
import { Button, Field, Press, Sheet, T } from "../kit";
import { useText } from "../language";
import { useColors } from "../theme";
import { TEXT } from "./text";
import { frequentItems } from "./view";

/** A short sheet: quick picks above a field that sits on the keyboard. Each item goes on the list at once, and the sheet stays open for the next. */
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
  const colors = useColors();
  const [name, setName] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const [everyWeek, setEveryWeek] = useState(false);
  const addedNames = useRef(new Set<string>());
  const onList = new Set([
    ...kitchen.extras.map((extra) => extra.name.toLowerCase()),
    ...added.map((one) => one.toLowerCase()),
  ]);
  const picks = frequentItems(kitchen, name).filter((one) => !onList.has(one.toLowerCase()));
  const weekly = kitchen.extras.filter((extra) => extra.everyWeek);
  const typed = clean(name);
  function add(item: string) {
    const trimmed = clean(item);
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
      footer={
        <View style={{ width: "100%", gap: 10 }}>
          <Press
            accessibilityRole="switch"
            accessibilityState={{ checked: everyWeek }}
            accessibilityHint={text.addEveryWeekHint}
            onPress={() => setEveryWeek(!everyWeek)}
            style={[
              styles.chip,
              {
                alignSelf: "flex-start",
                minHeight: 48,
                paddingRight: 12,
                backgroundColor: everyWeek ? colors.page.shopping : colors.control,
                borderColor: everyWeek ? colors.page.shopping : colors.controlBorder,
              },
            ]}
          >
            <Repeat color={everyWeek ? "#ffffff" : colors.mutedForeground} size={16} />
            <T weight="medium" style={{ fontSize: 14, color: everyWeek ? "#ffffff" : colors.foreground }}>
              {text.addEveryWeek}
            </T>
          </Press>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Field
              style={{ flex: 1 }}
              autoFocus
              value={name}
              onChangeText={setName}
              maxLength={120}
              accessibilityLabel={text.item}
              placeholder={text.itemPlaceholder}
              onSubmitEditing={() => add(name)}
              submitBehavior="submit"
              returnKeyType="send"
            />
            <Button
              icon={ArrowUp}
              accessibilityLabel={text.add}
              disabled={!typed || onList.has(typed.toLowerCase())}
              onPress={() => add(name)}
            />
          </View>
        </View>
      }
    >
      {added.length || picks.length ? (
        <View style={styles.wrap}>
          {added.map((item) => (
            <Chip key={item} label={item} on />
          ))}
          {picks.map((item) => (
            <Chip key={item} label={item} onPress={() => add(item)} />
          ))}
        </View>
      ) : !kitchen.ingredients.length ? (
        <T muted>{text.quickPicks}</T>
      ) : null}
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
    </Sheet>
  );
}

function clean(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function Chip({ label, on = false, onPress }: { label: string; on?: boolean; onPress?: () => void }) {
  const colors = useColors();
  return (
    <Press
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled: on }}
      disabled={on}
      onPress={onPress}
      style={[
        styles.chip,
        {
          minHeight: 48,
          paddingHorizontal: 12,
          backgroundColor: on ? colors.page.shopping : colors.control,
          borderColor: on ? colors.page.shopping : colors.controlBorder,
        },
      ]}
    >
      {on ? <Check color="#ffffff" size={16} /> : null}
      <T style={{ color: on ? "#ffffff" : colors.foreground, flexShrink: 1 }}>{label}</T>
    </Press>
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
