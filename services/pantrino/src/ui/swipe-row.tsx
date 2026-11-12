import { type LucideIcon, MoreVertical } from "lucide-react-native";
import * as SecureStore from "expo-secure-store";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { interpolate, type SharedValue, useAnimatedReaction, useAnimatedStyle } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { Press, Sheet, T, useKitText } from "./kit";
import { haptic } from "./haptics";
import { useColors } from "./theme";

const REACH = 96;
const THRESHOLD = 72;

export type SwipeAction = Readonly<{ label: string; icon: LucideIcon; color: string; run: () => void }>;

/**
 * A row that runs `right` on a swipe to the right and `left` on a swipe to the left. A row without an action for a
 * side does not move to that side. Each action also needs a visible control, such as a `RowMenu`, because a swipe
 * cannot be seen and some people cannot swipe.
 */
export function SwipeRow({ right, left, children }: { right?: SwipeAction; left?: SwipeAction; children: ReactNode }) {
  const swipe = useRef<SwipeableMethods>(null);
  return (
    <ReanimatedSwipeable
      ref={swipe}
      friction={1}
      leftThreshold={THRESHOLD}
      rightThreshold={THRESHOLD}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={right ? (_, translation) => <Panel side="left" translation={translation} action={right} /> : undefined}
      renderRightActions={left ? (_, translation) => <Panel side="right" translation={translation} action={left} /> : undefined}
      onSwipeableWillOpen={(direction) => {
        haptic("firm");
        (direction === "right" ? right : left)?.run();
        swipe.current?.close();
      }}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

/** The panel under a swiped row. It gets bright and ticks once the swipe passes the point where release runs it. */
function Panel({ side, translation, action: { color, icon: Icon, label } }: { side: "left" | "right"; translation: SharedValue<number>; action: SwipeAction }) {
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

/** The visible way to the actions of a swipeable row: a more button that opens them in a sheet. */
export function RowMenu({ name, actions }: { name: string; actions: readonly SwipeAction[] }) {
  const colors = useColors();
  const text = useKitText();
  const [open, setOpen] = useState(false);
  // iOS cannot present a sheet while another one is closing, so an action that opens a sheet waits for the menu to close.
  const chosen = useRef<() => void>(undefined);
  function choose(run: () => void) {
    setOpen(false);
    if (Platform.OS === "ios") chosen.current = run;
    else run();
  }
  return (
    <>
      <Press accessibilityRole="button" accessibilityLabel={text.actionsFor(name)} onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.more, pressed && { backgroundColor: colors.muted }]}>
        <MoreVertical size={20} color={colors.mutedForeground} />
      </Press>
      <Sheet open={open} onClose={() => setOpen(false)} onDismiss={() => { chosen.current?.(); chosen.current = undefined; }} title={name}>
        {actions.map(({ label, icon: Icon, color, run }) => (
          <Press key={label} accessibilityRole="button" onPress={() => choose(run)}
            style={({ pressed }) => [styles.menuItem, { backgroundColor: pressed ? colors.muted : colors.control, borderColor: colors.controlBorder }]}>
            <Icon size={20} color={color} />
            <T weight="medium" style={{ color }}>{label}</T>
          </Press>
        ))}
      </Sheet>
    </>
  );
}

const TIP_KEY = "pantrino.swipe-tip-shown";

/**
 * A one-time hint that a row can be swiped. NN/g advises to show a gesture shortcut just in time, after the person has
 * done the same action the slow way. `due()` is true once per install, the first time it is asked after a tap.
 */
export function useSwipeTip() {
  const shown = useRef(true);
  useEffect(() => {
    void SecureStore.getItemAsync(TIP_KEY).then((value) => { shown.current = value === "1"; }).catch(() => undefined);
  }, []);
  return {
    due() {
      if (shown.current) return false;
      shown.current = true;
      void SecureStore.setItemAsync(TIP_KEY, "1").catch(() => undefined);
      return true;
    },
  };
}

const styles = StyleSheet.create({
  action: { width: REACH, alignItems: "center", justifyContent: "center" },
  actionBody: { alignItems: "center", gap: 2 },
  more: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  menuItem: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1 },
});
