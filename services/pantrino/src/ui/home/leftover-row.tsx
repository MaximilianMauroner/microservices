import type { Leftover } from "@tools-platform/service/kitchen-contract";
import { Check, Trash2 } from "lucide-react-native";
import { useRef } from "react";
import { View } from "react-native";
import Animated, { FadeOut } from "react-native-reanimated";
import type { OpenKitchen } from "../../state";
import type { QueuedAction } from "../../sync/model";
import { Button, LIST_MOTION, type Notice, T, useByLabel } from "../kit";
import { useLanguage, useText } from "../language";
import { RowMenu, SwipeRow } from "../swipe-row";
import { useColors } from "../theme";
import { TEXT } from "./text";

export function LeftoverRow({ leftover, today, change, notify }: { leftover: Leftover; today: string; change: OpenKitchen["change"]; notify: (notice: Notice) => void }) {
  const text = useText(TEXT);
  const language = useLanguage();
  const colors = useColors();
  const acted = useRef(false);
  const label = useByLabel(leftover.useBy, today, language);
  const back: QueuedAction = { type: "leftover.add", name: leftover.name, servings: leftover.servings, useBy: leftover.useBy };
  function run(action: QueuedAction, message: string, undo?: QueuedAction) {
    if (acted.current) return;
    acted.current = true;
    change(action);
    notify({ message, undo: undo && [undo] });
  }
  const eat = () => run({ type: "leftover.eat", id: leftover.id, servings: Math.min(1, leftover.servings) }, text.ate(leftover.name), leftover.servings <= 1 ? back : undefined);
  const remove = () => run({ type: "leftover.remove", id: leftover.id }, text.thrownAway(leftover.name), back);
  return <Animated.View layout={LIST_MOTION} exiting={FadeOut.duration(140)} style={{ borderRadius: 16, overflow: "hidden" }}>
    <SwipeRow right={{ label: text.ateOne, icon: Check, color: colors.pageInk.kitchen, run: eat }} left={{ label: text.throwAway, icon: Trash2, color: colors.destructive, run: remove }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, padding: 12, backgroundColor: colors.card }}>
        <View style={{ flexGrow: 1, flexBasis: 150, gap: 2 }}>
          <T weight="medium">{leftover.name}</T>
          <T muted style={{ fontSize: 13 }}>{text.servings(leftover.servings)}</T>
          <T style={{ fontSize: 13, color: label.urgent ? colors.destructive : colors.mutedForeground }}>{label.text}</T>
        </View>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Button tone="outline" label={text.ateOne} onPress={eat} />
          <RowMenu name={leftover.name} actions={[{ label: text.throwAway, icon: Trash2, color: colors.destructive, run: remove }]} />
        </View>
      </View>
    </SwipeRow>
  </Animated.View>;
}
