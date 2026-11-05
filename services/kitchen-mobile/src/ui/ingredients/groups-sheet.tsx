import { ingredientGroups, UNSORTED_SECTION, type KitchenSnapshot } from "@tools-platform/service/kitchen-contract";
import { ArrowDown, ArrowUp } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import type { OpenKitchen } from "../../state";
import { byGroup, Button, GroupDot, groupLabel, Sheet, T } from "../kit";
import { useLanguage, useText } from "../language";
import { RADIUS, useColors } from "../theme";
import { TEXT } from "./text";

export function GroupsSheet({ kitchen, change, onClose }: { kitchen: KitchenSnapshot; change: OpenKitchen["change"]; onClose: () => void }) {
  const text = useText(TEXT);
  const language = useLanguage();
  const colors = useColors();
  const counts = byGroup(kitchen.kitchen.groups, kitchen.ingredients.flatMap(ingredientGroups), (group) => group).filter(([group]) => group !== UNSORTED_SECTION);
  const [order, setOrder] = useState(() => counts.map(([group]) => group));
  const sizes = new Map(counts.map(([group, items]) => [group, items.length]));
  const move = (index: number, offset: number) => setOrder((current) => {
    const next = [...current];
    const [group] = next.splice(index, 1);
    next.splice(index + offset, 0, group!);
    return next;
  });
  return (
    <Sheet open onClose={onClose} title={text.arrangeGroups} description={text.arrangeDescription}
      footer={<Button label={text.saveOrder} onPress={() => { change({ type: "groups.set", groups: order }); onClose(); }} />}>
      {order.map((group, index) => (
        <View key={group} style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: RADIUS, borderWidth: 1, borderColor: colors.border, paddingLeft: 12, paddingRight: 4, paddingVertical: 4 }}>
          <GroupDot groups={order} group={group} />
          <T weight="medium" style={{ flex: 1 }}>{groupLabel(group, language)} <T muted>{sizes.get(group)}</T></T>
          <Button tone="ghost" icon={ArrowUp} accessibilityLabel={text.moveUp(group)} disabled={index === 0} onPress={() => move(index, -1)} />
          <Button tone="ghost" icon={ArrowDown} accessibilityLabel={text.moveDown(group)} disabled={index === order.length - 1} onPress={() => move(index, 1)} />
        </View>
      ))}
    </Sheet>
  );
}
