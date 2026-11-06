import { router } from "expo-router";
import { ChevronRight, Leaf, type LucideIcon, RefreshCw, Users } from "lucide-react-native";
import { type ReactNode, useContext, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from "react-native";
import { useApp, useKitchen, useSync } from "../../state";
import type { SyncStatus } from "../../sync/model";
import { Button, HueBadge, Screen, Sheet, T } from "../kit";
import { KITCHEN_LANGUAGES, type KitchenLanguage, LANGUAGE_NAMES, LanguageContext, LOCALES, useText } from "../language";
import { tint, useColors } from "../theme";
import { TEXT } from "./text";

/** The Kitchen tab: the open kitchen, its ingredients and members, sync, language, and sign-out. It works before the first kitchen arrives. */
export function KitchenHub() {
  const open = useKitchen();
  const { signOut, openKitchen } = useApp();
  const { status, pending, notices, sync, dismiss } = useSync();
  const { language, setLanguage } = useContext(LanguageContext);
  const text = useText(TEXT);
  const colors = useColors();
  const [switching, setSwitching] = useState(false);
  const kitchen = open?.kitchen;
  const state = syncLine(status, language);
  const confirmSignOut = () => Alert.alert(text.signOutTitle, pending ? text.signOutLoses(pending) : text.signOutBody, [
    { text: text.cancel, style: "cancel" },
    { text: text.signOut, style: "destructive", onPress: () => void signOut() }
  ]);

  return (
    <Screen title={text.title}>
      {open && kitchen ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <HueBadge size={44} />
          <View style={{ flex: 1, gap: 2 }}>
            <T weight="semibold" numberOfLines={1} style={{ fontSize: 18 }}>{kitchen.kitchen.name}</T>
            <T muted style={styles.small}>{text.members(kitchen.kitchen.members.length)} · {state}</T>
          </View>
          {open.kitchens.length > 1 ? <Button tone="outline" compact label={text.switchKitchen} onPress={() => setSwitching(true)} /> : null}
        </View>
      ) : <T muted>{text.noKitchen}</T>}
      {kitchen ? (
        <List>
          <Row icon={Leaf} title={text.ingredients} detail={text.ingredientsDetail(kitchen.ingredients.length, kitchen.kitchen.groups.length)} onPress={() => router.push("/kitchen/ingredients")} />
          <Row icon={Users} title={text.membersTitle} detail={`${kitchen.kitchen.members.map((member) => member.email).join(", ") || text.noMembers}. ${text.membersHint}`} />
        </List>
      ) : null}
      <List>
        <Row icon={RefreshCw} title={text.syncNow} detail={[state, pending ? text.unsent(pending) : ""].filter(Boolean).join(" · ")} onPress={() => void sync()}
          trailing={status.kind === "syncing" ? <ActivityIndicator color={colors.mutedForeground} /> : undefined} />
      </List>
      {notices.map((notice) => (
        <View key={notice.clientActionId} style={{ padding: 12, borderRadius: 12, backgroundColor: tint(colors.destructive, 12, colors.card), gap: 8 }}>
          <T weight="semibold" style={{ color: colors.destructive }}>{text.refused}</T>
          <T>{notice.message}</T>
          <View style={{ flexDirection: "row" }}><Button tone="outline" compact label={text.dismiss} onPress={() => void dismiss(notice.clientActionId)} /></View>
        </View>
      ))}
      <List>
        <Row title={text.language} trailing={
          <View style={{ flexDirection: "row", gap: 8 }}>
            {KITCHEN_LANGUAGES.map((one) => <Button key={one} tone={one === language ? "primary" : "outline"} compact label={LANGUAGE_NAMES[one]} onPress={() => setLanguage(one)} />)}
          </View>
        } />
      </List>
      <View style={{ flexDirection: "row" }}><Button tone="destructive" label={text.signOut} onPress={confirmSignOut} /></View>
      <Sheet open={switching} onClose={() => setSwitching(false)} title={text.kitchens}>
        {open?.kitchens.map(({ kitchen: one }) => {
          const active = one.id === kitchen?.kitchen.id;
          return (
            <Pressable key={one.id} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => { openKitchen(one.id); setSwitching(false); }}
              style={{ padding: 14, borderRadius: 14, borderWidth: 1, borderColor: active ? colors.foreground : colors.border, backgroundColor: colors.control }}>
              <T weight="semibold">{one.name}</T>
              <T muted style={{ fontSize: 13, marginTop: 2 }}>{one.members.length ? one.members.map((member) => member.email).join(", ") : text.noMembers}</T>
            </Pressable>
          );
        })}
      </Sheet>
    </Screen>
  );
}

/** What the Kitchen tab marks on its icon when sync needs a look. A failed sync or a refused change is a warning. */
export function useSyncAlert(): { label: string; warn: boolean } | null {
  const { status, pending, notices } = useSync();
  const text = useText(TEXT);
  if (status.kind === "failed" || notices.length) return { label: text.failed, warn: true };
  if (status.kind === "offline") return { label: text.offline, warn: false };
  if (pending && status.kind !== "syncing") return { label: text.unsent(pending), warn: false };
  return null;
}

function syncLine(status: SyncStatus, language: KitchenLanguage): string {
  const text = TEXT[language];
  if (status.kind === "syncing") return text.syncing;
  if (status.kind === "offline") return text.offline;
  if (status.kind === "failed") return `${text.failed}: ${status.message}`;
  if (!status.syncedAt) return text.syncing;
  return text.synced(new Date(status.syncedAt).toLocaleTimeString(LOCALES[language], { hour: "2-digit", minute: "2-digit" }));
}

function List({ children }: { children: ReactNode }) {
  const colors = useColors();
  const rows = Array.isArray(children) ? children.flat().filter(Boolean) : [children];
  return (
    <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {rows.map((row, index) => <View key={index} style={index ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : undefined}>{row}</View>)}
    </View>
  );
}

function Row({ icon: Icon, title, detail, onPress, trailing }: { icon?: LucideIcon; title: string; detail?: string; onPress?: () => void; trailing?: ReactNode }) {
  const colors = useColors();
  const body = <>
    {Icon ? <Icon size={20} color={colors.mutedForeground} /> : null}
    <View style={{ flex: 1, gap: 2 }}>
      <T weight="medium">{title}</T>
      {detail ? <T muted style={styles.small}>{detail}</T> : null}
    </View>
    {trailing ?? (onPress ? <ChevronRight size={18} color={colors.mutedForeground} /> : null)}
  </>;
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>{body}</Pressable>;
}

const styles = StyleSheet.create({
  small: { fontSize: 13 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  list: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10 }
});
