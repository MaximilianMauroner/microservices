import { router } from "expo-router";
import { ChevronRight, Info, LogIn, LogOut, MessageSquareWarning, type LucideIcon, RefreshCw, Users } from "lucide-react-native";
import { type ReactNode, useContext, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import { useApp, useKitchen, useSync } from "../../state";
import type { SyncStatus } from "../../sync/model";
import { Button, useKitText, HueBadge, Press, Screen, Sheet, T, usePageColor } from "../kit";
import { KITCHEN_LANGUAGES, type KitchenLanguage, LANGUAGE_NAMES, LanguageContext, LOCALES, useText } from "../language";
import { haptic, useHaptics, VIBRATION } from "../haptics";
import { tint, useColors } from "../theme";
import { LocalModeNotice } from "../local-mode-notice";
import { useLocalText } from "../local-mode";
import { ReportSheet } from "../report-sheet";
import { TEXT } from "./text";

/** The Kitchen tab: the open kitchen, its ingredients and members, sync, language, and sign-out. It works before the first kitchen arrives. */
export function KitchenHub() {
  const open = useKitchen();
  const { signOut, openKitchen, openLocal, showSignIn, session, hasLocal } = useApp();
  const { status, pending, notices, sync, dismiss } = useSync();
  const { language, setLanguage } = useContext(LanguageContext);
  const { vibration, setVibration } = useHaptics();
  const text = useText(TEXT);
  const kitText = useKitText();
  const localText = useLocalText();
  const colors = useColors();
  const [switching, setSwitching] = useState(false);
  const [reporting, setReporting] = useState(false);
  const kitchen = open?.kitchen;
  const state = status.kind === "local" ? localText.title : syncLine(status, language);
  const confirmSignOut = () => Alert.alert(text.signOutTitle, pending ? text.signOutLoses(pending) : text.signOutBody, [
    { text: text.cancel, style: "cancel" },
    { text: text.signOut, style: "destructive", onPress: () => void signOut() }
  ]);

  return (
    <Screen title={kitText.profile} back={{ label: kitText.back, onPress: () => router.back() }}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <HueBadge size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <T weight="semibold" style={{ fontSize: 18 }}>{open && kitchen ? kitchen.kitchen.name : text.noKitchen}</T>
          <T muted style={styles.small}>{[state, pending ? text.unsent(pending) : ""].filter(Boolean).join(" · ")}</T>
        </View>
        <Press accessibilityRole="button" accessibilityLabel={session === "local" ? localText.title : text.syncNow} accessibilityState={{ busy: status.kind === "syncing" }} onPress={() => session === "local" ? Alert.alert(localText.title, localText.limits) : void sync()}
          style={({ pressed }) => [styles.sync, { borderColor: colors.controlBorder, backgroundColor: colors.control, opacity: pressed ? 0.7 : 1 }]}>
          {status.kind === "syncing" ? <ActivityIndicator color={colors.mutedForeground} /> : session === "local" ? <Info size={20} color={colors.foreground} /> : <RefreshCw size={20} color={colors.foreground} />}
        </Press>
      </View>
      <LocalModeNotice />
      {open && open.kitchens.length > 1 ? <Button tone="outline" label={text.switchKitchen} onPress={() => setSwitching(true)} /> : null}
      {kitchen ? <>
        {session === "signed-in" ? <View style={styles.note}>
          <Users size={18} color={colors.mutedForeground} />
          <T muted style={[styles.small, { flex: 1 }]}>{`${kitchen.kitchen.members.map((member) => member.email).join(", ") || text.noMembers}. ${text.membersHint}`}</T>
        </View> : null}
      </> : null}
      {notices.map((notice) => (
        <View key={notice.clientActionId} style={{ padding: 12, borderRadius: 12, backgroundColor: tint(colors.destructive, 12, colors.card), gap: 8 }}>
          <T weight="semibold" style={{ color: colors.destructive }}>{text.refused}</T>
          <T>{"unsaved" in notice ? text.unsaved : notice.message}</T>
          <View style={{ flexDirection: "row" }}><Button tone="outline" compact label={text.dismiss} onPress={() => void dismiss(notice.clientActionId)} /></View>
        </View>
      ))}
      <Choice label={text.language} options={KITCHEN_LANGUAGES} names={LANGUAGE_NAMES} value={language} onValue={setLanguage} />
      <Choice label={text.vibration} options={VIBRATION} names={text.vibrations} value={vibration} silent onValue={(next) => { setVibration(next); haptic("toggle"); }} />
      {session === "local" ? <T muted style={styles.small}>{localText.separate}</T> : <Button tone="outline" label={hasLocal ? localText.returnLocal : localText.useLocal} onPress={() => Alert.alert(localText.title, `${localText.limits}\n\n${localText.accountWarning}`, [
        { text: text.cancel, style: "cancel" },
        { text: hasLocal ? localText.returnLocal : localText.useLocal, onPress: () => void openLocal().catch(() => undefined) },
      ])} />}
      <List>
        <Row icon={MessageSquareWarning} title={text.report} detail={text.reportDetail} onPress={() => setReporting(true)} />
      </List>
      <List>
        <Press accessibilityRole="button" onPress={session === "local" ? () => void showSignIn().catch(() => undefined) : confirmSignOut} style={({ pressed }) => [styles.row, { justifyContent: "center", opacity: pressed ? 0.7 : 1 }]}>
          {session === "local" ? <LogIn size={18} color={colors.foreground} /> : <LogOut size={18} color={colors.destructive} />}
          <T weight="medium" style={{ color: session === "local" ? colors.foreground : colors.destructive }}>{session === "local" ? localText.signIn : text.signOut}</T>
        </Press>
      </List>
      <ReportSheet open={reporting} onClose={() => setReporting(false)} signedIn={session === "signed-in"} page="/settings" />
      <Sheet open={switching} onClose={() => setSwitching(false)} title={text.kitchens}>
        {open?.kitchens.map(({ kitchen: one }) => {
          const active = one.id === kitchen?.kitchen.id;
          return (
            <Press key={one.id} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => { openKitchen(one.id); setSwitching(false); }}
              style={{ padding: 14, borderRadius: 14, borderWidth: 1, borderColor: active ? colors.foreground : colors.border, backgroundColor: colors.control }}>
              <T weight="semibold">{one.name}</T>
              <T muted style={{ fontSize: 13, marginTop: 2 }}>{one.members.length ? one.members.map((member) => member.email).join(", ") : text.noMembers}</T>
            </Press>
          );
        })}
      </Sheet>
    </Screen>
  );
}

/** One setting as a row of segments, one per option. A `silent` choice does not vibrate on its own, so turning vibration on vibrates and turning it off does not. */
function Choice<Option extends string>({ label, options, names, value, onValue, silent }: { label: string; options: readonly Option[]; names: Record<Option, string>; value: Option; onValue: (option: Option) => void; silent?: boolean }) {
  const colors = useColors();
  const { hue } = usePageColor();
  return (
    <View style={{ gap: 8 }}>
      <T weight="medium" style={{ fontSize: 14 }} muted>{label}</T>
      <View accessibilityRole="radiogroup" style={[styles.segments, { backgroundColor: colors.muted }]}>
        {options.map((one) => {
          const selected = one === value;
          return (
            <Press key={one} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => onValue(one)} feel={silent ? null : undefined}
              style={[styles.segment, selected && { backgroundColor: hue }]}>
              <T weight={selected ? "semibold" : "medium"} style={{ color: selected ? "#ffffff" : colors.foreground }}>{names[one]}</T>
            </Press>
          );
        })}
      </View>
    </View>
  );
}

function syncLine(status: Exclude<SyncStatus, { kind: "local" }>, language: KitchenLanguage): string {
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
  return <Press accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>{body}</Press>;
}

const styles = StyleSheet.create({
  small: { fontSize: 13 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  list: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  sync: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 14 },
  segments: { flexDirection: "row", borderRadius: 14, padding: 4, gap: 4 },
  segment: { flex: 1, minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10 }
});
