import { ChevronDown, CloudOff, RefreshCw, Settings } from "lucide-react-native";
import { useContext, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useApp, useKitchen, useSync } from "../state";
import { Button, Sheet, T } from "./kit";
import { KITCHEN_LANGUAGES, type KitchenLanguage, LANGUAGE_NAMES, LanguageContext, useText } from "./language";
import { tint, useColors } from "./theme";

const en = {
  kitchens: "Kitchens",
  noMembers: "No members yet",
  settings: "Settings",
  language: "Language",
  syncing: "Syncing",
  offline: "Offline",
  failed: "Sync failed",
  unsent: (count: number) => (count === 1 ? "1 change not sent" : `${count} changes not sent`),
  synced: (time: string) => `Synced ${time}`,
  syncNow: "Sync now",
  refused: "Not saved",
  dismiss: "OK",
  signOut: "Sign out",
  signOutTitle: "Sign out?",
  signOutLoses: (count: number) => `${count === 1 ? "1 change was" : `${count} changes were`} not sent yet. Signing out deletes ${count === 1 ? "it" : "them"} and every kitchen on this phone.`,
  signOutBody: "This deletes every kitchen on this phone. Sign in again to download them.",
  cancel: "Cancel"
};
const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: {
    kitchens: "Küchen",
    noMembers: "Noch keine Mitglieder",
    settings: "Einstellungen",
    language: "Sprache",
    syncing: "Synchronisiert",
    offline: "Offline",
    failed: "Synchronisierung fehlgeschlagen",
    unsent: (count: number) => (count === 1 ? "1 Änderung nicht gesendet" : `${count} Änderungen nicht gesendet`),
    synced: (time: string) => `Synchronisiert ${time}`,
    syncNow: "Jetzt synchronisieren",
    refused: "Nicht gespeichert",
    dismiss: "OK",
    signOut: "Abmelden",
    signOutTitle: "Abmelden?",
    signOutLoses: (count: number) => `${count === 1 ? "1 Änderung wurde" : `${count} Änderungen wurden`} noch nicht gesendet. Abmelden löscht ${count === 1 ? "sie" : "sie"} und alle Küchen auf diesem Telefon.`,
    signOutBody: "Das löscht alle Küchen auf diesem Telefon. Melde dich wieder an, um sie zu laden.",
    cancel: "Abbrechen"
  }
};

/** The kitchen switcher, the sync state, and the settings, above every page. */
export function TopBar() {
  const kitchen = useKitchen();
  const sync = useSync();
  const { openKitchen } = useApp();
  const colors = useColors();
  const text = useText(TEXT);
  const [open, setOpen] = useState<"kitchens" | "settings" | null>(null);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={text.kitchens} onPress={() => setOpen("kitchens")} style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
        <T weight="semibold" numberOfLines={1} style={{ fontSize: 17, flexShrink: 1 }}>{kitchen?.kitchen.kitchen.name ?? " "}</T>
        <ChevronDown size={18} color={colors.mutedForeground} />
      </Pressable>
      <View style={{ flex: 1 }} />
      <SyncBadge onPress={() => setOpen("settings")} />
      <Button tone="ghost" compact icon={Settings} onPress={() => setOpen("settings")} accessibilityLabel={text.settings} />
      <Sheet open={open === "kitchens"} onClose={() => setOpen(null)} title={text.kitchens}>
        {kitchen?.kitchens.map(({ kitchen: one }) => {
          const active = one.id === kitchen.kitchen.kitchen.id;
          return (
            <Pressable key={one.id} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => { openKitchen(one.id); setOpen(null); }}
              style={{ padding: 14, borderRadius: 14, borderWidth: 1, borderColor: active ? colors.foreground : colors.border, backgroundColor: colors.control }}>
              <T weight="semibold">{one.name}</T>
              <T muted style={{ fontSize: 13, marginTop: 2 }}>{one.members.length ? one.members.map((member) => member.email).join(", ") : text.noMembers}</T>
            </Pressable>
          );
        })}
      </Sheet>
      <SettingsSheet open={open === "settings"} onClose={() => setOpen(null)} pending={sync.pending} />
    </View>
  );
}

function SyncBadge({ onPress }: { onPress: () => void }) {
  const { status, pending, notices } = useSync();
  const colors = useColors();
  const text = useText(TEXT);
  const label = status.kind === "syncing" ? text.syncing : status.kind === "offline" ? text.offline : status.kind === "failed" || notices.length ? text.failed : pending ? text.unsent(pending) : null;
  if (!label) return null;
  const warn = status.kind === "failed" || notices.length > 0;
  const Icon = status.kind === "offline" ? CloudOff : RefreshCw;
  const color = warn ? colors.destructive : colors.mutedForeground;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: tint(color, 14, colors.background) }}>
      <Icon size={14} color={color} />
      <T weight="medium" style={{ fontSize: 12, color }}>{pending && status.kind !== "syncing" ? String(pending) : label}</T>
    </Pressable>
  );
}

function SettingsSheet({ open, onClose, pending }: { open: boolean; onClose: () => void; pending: number }) {
  const { signOut } = useApp();
  const { status, notices, sync, dismiss } = useSync();
  const { language, setLanguage } = useContext(LanguageContext);
  const colors = useColors();
  const text = useText(TEXT);
  const syncedAt = "syncedAt" in status && status.syncedAt ? new Date(status.syncedAt).toLocaleTimeString(language === "de" ? "de-AT" : "en-GB", { hour: "2-digit", minute: "2-digit" }) : null;
  const confirmSignOut = () => Alert.alert(text.signOutTitle, pending ? text.signOutLoses(pending) : text.signOutBody, [
    { text: text.cancel, style: "cancel" },
    { text: text.signOut, style: "destructive", onPress: () => { onClose(); void signOut(); } }
  ]);
  return (
    <Sheet open={open} onClose={onClose} title={text.settings}>
      <View style={{ gap: 6 }}>
        <T muted>{status.kind === "syncing" ? text.syncing : status.kind === "offline" ? text.offline : status.kind === "failed" ? `${text.failed}: ${status.message}` : syncedAt ? text.synced(syncedAt) : text.syncing}</T>
        {pending ? <T muted>{text.unsent(pending)}</T> : null}
        <View style={{ flexDirection: "row" }}><Button tone="outline" compact icon={RefreshCw} label={text.syncNow} onPress={() => void sync()} /></View>
      </View>
      {notices.map((notice) => (
        <View key={notice.clientActionId} style={{ padding: 12, borderRadius: 12, backgroundColor: tint(colors.destructive, 12, colors.card), gap: 8 }}>
          <T weight="semibold" style={{ color: colors.destructive }}>{text.refused}</T>
          <T>{notice.message}</T>
          <View style={{ flexDirection: "row" }}><Button tone="outline" compact label={text.dismiss} onPress={() => void dismiss(notice.clientActionId)} /></View>
        </View>
      ))}
      <T weight="semibold" style={{ marginTop: 8 }}>{text.language}</T>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {KITCHEN_LANGUAGES.map((one) => <Button key={one} tone={one === language ? "primary" : "outline"} compact label={LANGUAGE_NAMES[one]} onPress={() => setLanguage(one)} />)}
      </View>
      <View style={{ flexDirection: "row", marginTop: 16 }}><Button tone="destructive" label={text.signOut} onPress={confirmSignOut} /></View>
    </Sheet>
  );
}
