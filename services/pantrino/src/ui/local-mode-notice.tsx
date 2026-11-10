import { View } from "react-native";
import { useSync } from "../state";
import { T } from "./kit";
import { useLocalText } from "./local-mode";
import { useColors } from "./theme";

export function LocalModeNotice() {
  const { status } = useSync();
  const text = useLocalText();
  const colors = useColors();
  if (status.kind !== "local") return null;
  return (
    <View style={{ gap: 6, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
      <T weight="semibold">{text.title}</T>
      <T accessibilityLiveRegion="polite" style={{ fontSize: 13, color: status.persistence === "failed" ? colors.destructive : colors.mutedForeground }}>
        {status.persistence === "saving" ? text.saving : status.persistence === "failed" ? text.failed : text.saved}
      </T>
      <T muted style={{ fontSize: 13 }}>{text.limits}</T>
    </View>
  );
}
