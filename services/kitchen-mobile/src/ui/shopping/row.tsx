import * as Crypto from "expo-crypto";
import { formatAmount } from "@tools-platform/service/kitchen-contract";
import { Check, Trash2 } from "lucide-react-native";
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Press, T } from "../kit";
import { RowMenu, type SwipeAction, SwipeRow } from "../swipe-row";
import { useLanguage, useText } from "../language";
import { ink, tint, useColors } from "../theme";
import { TEXT } from "./text";
import { type RowChange, type RowGesture, rowChanges, type ShoppingRow, SWIPE } from "./view";

type RowProps = { row: ShoppingRow; color: string; onChange: (change: RowChange, tapped: boolean) => void };

/**
 * A shopping row. A tap or a swipe right checks it. A swipe left removes it when the row allows that. Its more button
 * offers the same actions. Give it a key by item, so the list can animate it; it starts fresh when its amounts change.
 */
export function ListRow(props: RowProps) {
  const { row } = props;
  const version = row.kind === "line" ? `${row.line.inStock}:${row.line.toBuy}` : row.kind === "weekly" ? `${row.week}:${row.extra.bought}` : "";
  return <RowBody key={version} {...props} />;
}

function RowBody({ row, color, onChange }: RowProps) {
  const text = useText(TEXT);
  const language = useLanguage();
  const colors = useColors();
  const changes = rowChanges(row, text, language, Crypto.randomUUID);
  const [checked, setChecked] = useState(row.kind === "weekly" && row.extra.bought);
  const used = useRef(false);
  const name = row.kind === "line" ? row.line.ingredient : row.extra.name;
  const amount = row.kind === "line" ? formatAmount(row.line.toBuy, row.line.unit, language) : undefined;
  const detail =
    row.kind === "line"
      ? `${row.line.inStock ? `${text.inStock(formatAmount(row.line.inStock, row.line.unit, language))}. ` : ""}${text.forRecipes(row.line.recipes.join(", "))}`
      : undefined;
  const removable = Boolean(changes.remove);
  function run(gesture: RowGesture, tapped = false) {
    const change = changes[gesture];
    if (!change || used.current) return;
    used.current = true;
    if (gesture === "check") setChecked(!checked);
    onChange(change, tapped);
  }
  const background = tint(color, 11, colors.card);
  const remove: SwipeAction | undefined = removable ? { label: text.remove, icon: Trash2, color: colors.destructive, run: () => run(SWIPE.left) } : undefined;
  const buy: SwipeAction | undefined = checked ? undefined : { label: text.markBought, icon: Check, color: ink(color, colors), run: () => run(SWIPE.right) };
  const actions = [buy, remove].filter((one): one is SwipeAction => Boolean(one));
  return (
    <SwipeRow right={buy} left={remove}>
      <View style={[styles.line, { backgroundColor: background }]}>
        <Press
          accessibilityRole="checkbox"
          accessibilityLabel={text.boughtAria(name, amount)}
          accessibilityState={{ checked }}
          accessibilityActions={removable ? [{ name: "remove", label: text.remove }] : undefined}
          onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === "remove") run("remove"); }}
          onPress={() => run("check", true)}
          style={({ pressed }) => [styles.row, actions.length > 0 && { paddingRight: 0 }, pressed && { opacity: 0.7 }]}
        >
          <View style={[styles.box, { borderColor: color, backgroundColor: checked ? color : colors.card }]}>
            {checked ? <Check size={17} strokeWidth={3} color={colors.background} /> : null}
          </View>
          <View style={{ flex: 1 }}>
            <T weight="medium" style={checked ? { textDecorationLine: "line-through", color: colors.mutedForeground } : undefined}>{name}</T>
            {detail ? <T muted style={{ fontSize: 12, marginTop: 2 }}>{detail}</T> : null}
          </View>
          {amount ? <T weight="semibold" style={{ color: ink(color, colors), fontSize: 14 }}>{amount}</T> : null}
        </Press>
        {actions.length ? <RowMenu name={name} actions={actions} /> : null}
      </View>
    </SwipeRow>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "center", paddingRight: 4 },
  row: { flex: 1, minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  box: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
});
