import { formatAmount } from "@tools-platform/service/kitchen-contract";
import { Check, type LucideIcon, Trash2 } from "lucide-react-native";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { interpolate, type SharedValue, useAnimatedReaction, useAnimatedStyle } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptic, T } from "../kit";
import { useLanguage, useText } from "../language";
import { ink, tint, useColors } from "../theme";
import { TEXT } from "./text";
import { type RowChange, type RowGesture, rowChanges, type ShoppingRow, SWIPE } from "./view";

const REACH = 96;
const THRESHOLD = 72;

/** A shopping row. A tap or a swipe right checks it, a swipe left removes it when the row allows that. */
export function ListRow({ row, color, onChange }: { row: ShoppingRow; color: string; onChange: (change: RowChange) => void }) {
  const text = useText(TEXT);
  const language = useLanguage();
  const colors = useColors();
  const changes = rowChanges(row, text, language);
  const [checked, setChecked] = useState(row.kind === "weekly" && row.extra.bought);
  const used = useRef(false);
  const swipe = useRef<SwipeableMethods>(null);
  const name = row.kind === "line" ? row.line.ingredient : row.extra.name;
  const amount = row.kind === "line" ? formatAmount(row.line.toBuy, row.line.unit, language) : undefined;
  const detail =
    row.kind === "line"
      ? `${row.line.inStock ? `${text.inStock(formatAmount(row.line.inStock, row.line.unit, language))}. ` : ""}${text.forRecipes(row.line.recipes.join(", "))}`
      : undefined;
  const removable = Boolean(changes.remove);
  function run(gesture: RowGesture) {
    const change = changes[gesture];
    if (!change || used.current) return swipe.current?.close();
    used.current = true;
    if (gesture === "check") setChecked(!checked);
    onChange(change);
  }
  const background = tint(color, 11, colors.card);
  return (
    <ReanimatedSwipeable
      ref={swipe}
      friction={1}
      leftThreshold={THRESHOLD}
      rightThreshold={THRESHOLD}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={checked ? undefined : (_, translation) => <Action side="left" translation={translation} color={color} icon={Check} label={text.markBought} />}
      renderRightActions={removable ? (_, translation) => <Action side="right" translation={translation} color={colors.destructive} icon={Trash2} label={text.remove} /> : undefined}
      onSwipeableWillOpen={(direction) => run(SWIPE[direction])}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={text.boughtAria(name, amount)}
        accessibilityState={{ checked }}
        accessibilityActions={removable ? [{ name: "remove", label: text.remove }] : undefined}
        onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === "remove") run("remove"); }}
        onPress={() => run("check")}
        style={({ pressed }) => [styles.row, { backgroundColor: background }, pressed && { opacity: 0.7 }]}
      >
        <View style={[styles.box, { borderColor: color, backgroundColor: checked ? color : colors.card }]}>
          {checked ? <Check size={17} strokeWidth={3} color={colors.background} /> : null}
        </View>
        <View style={{ flex: 1 }}>
          <T weight="medium" style={checked ? { textDecorationLine: "line-through", color: colors.mutedForeground } : undefined}>{name}</T>
          {detail ? <T muted style={{ fontSize: 12, marginTop: 2 }}>{detail}</T> : null}
        </View>
        {amount ? <T weight="semibold" style={{ color: ink(color, colors), fontSize: 14 }}>{amount}</T> : null}
      </Pressable>
    </ReanimatedSwipeable>
  );
}

/** The panel under a swiped row. It gets bright and ticks once the swipe passes the point where release runs it. */
function Action({ side, translation, color, icon: Icon, label }: { side: "left" | "right"; translation: SharedValue<number>; color: string; icon: LucideIcon; label: string }) {
  const sign = side === "left" ? 1 : -1;
  useAnimatedReaction(
    () => translation.value * sign >= THRESHOLD,
    (past, before) => { if (past && before === false) scheduleOnRN(haptic, "threshold"); },
  );
  const content = useAnimatedStyle(() => ({ opacity: interpolate(translation.value * sign, [0, THRESHOLD], [0.35, 1], "clamp") }));
  return (
    <View style={[styles.action, { backgroundColor: color }]}>
      <Animated.View style={[styles.actionBody, content]}>
        <Icon size={20} color="#ffffff" />
        <T weight="semibold" style={{ color: "#ffffff", fontSize: 12 }}>{label}</T>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  box: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  action: { width: REACH, alignItems: "center", justifyContent: "center" },
  actionBody: { alignItems: "center", gap: 2 },
});
