import { byGroupOrder, addDays, UNSORTED_SECTION } from "@tools-platform/service/kitchen-contract";
import * as Haptics from "expo-haptics";
import { BookOpen, CalendarDays, CookingPot, type LucideIcon, Refrigerator, Search, ShoppingBasket, X } from "lucide-react-native";
import { createContext, type ReactNode, type Ref, useContext, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, type RefreshControlProps, ScrollView, type ScrollViewInstance, StyleSheet, Text, type TextProps, TextInput, type TextInputProps, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import { useSync } from "../state";
import type { QueuedAction } from "../sync/model";
import { type KitchenLanguage, LOCALES, useText } from "./language";
import { type Colors, FONT, groupColor, ink, type PageKey, RADIUS, tint, useColors } from "./theme";

/** The bottom tabs in their order. `route` is the screen name under `app/(tabs)`. */
export const PAGES: readonly { key: PageKey; route: string; icon: LucideIcon }[] = [
  { key: "week", route: "index", icon: CalendarDays },
  { key: "shopping", route: "shopping", icon: ShoppingBasket },
  { key: "recipes", route: "recipes", icon: BookOpen },
  { key: "home", route: "home", icon: Refrigerator },
  { key: "kitchen", route: "kitchen", icon: CookingPot }
];

const en = {
  tabs: { week: ["Week", "Week"], shopping: ["Shopping list", "Shop"], recipes: ["Recipes", "Recipes"], home: ["At home", "At home"], kitchen: ["Kitchen", "Kitchen"] } as Record<PageKey, [string, string]>,
  close: "Close",
  fewer: (label: string) => `Fewer ${label.toLowerCase()}`,
  more: (label: string) => `More ${label.toLowerCase()}`,
  thisWeek: "This week",
  nextWeek: "Next week",
  lastWeek: "Last week",
  range: (from: string, to: string) => `${from} to ${to}`,
  pastUseBy: (day: string) => `Past use-by (${day})`,
  useToday: "Use today",
  useTomorrow: "Use by tomorrow",
  useBy: (day: string) => `Use by ${day}`,
  other: "Other",
  clearSearch: "Clear search",
  undo: "Undo"
};
const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: {
    tabs: { week: ["Woche", "Woche"], shopping: ["Einkaufsliste", "Einkauf"], recipes: ["Rezepte", "Rezepte"], home: ["Vorrat", "Vorrat"], kitchen: ["Küche", "Küche"] },
    close: "Schließen",
    fewer: (label: string) => `Weniger ${label}`,
    more: (label: string) => `Mehr ${label}`,
    thisWeek: "Diese Woche",
    nextWeek: "Nächste Woche",
    lastWeek: "Letzte Woche",
    range: (from: string, to: string) => `${from} bis ${to}`,
    pastUseBy: (day: string) => `Abgelaufen (${day})`,
    useToday: "Heute verbrauchen",
    useTomorrow: "Bis morgen verbrauchen",
    useBy: (day: string) => `Verbrauchen bis ${day}`,
    other: "Sonstiges",
    clearSearch: "Suche löschen",
    undo: "Rückgängig"
  }
};

export function useKitText() {
  return useText(TEXT);
}

/** The open page. Its produce color tints the title badge, the main buttons, and the sheets. */
export const PageContext = createContext<PageKey>("week");

export function usePageColor(): { hue: string; ink: string } {
  const colors = useColors();
  const page = useContext(PageContext);
  return { hue: colors.page[page], ink: colors.pageInk[page] };
}

/** Text in Instrument Sans. `weight` picks the font file, because React Native has no variable font weight. */
export function T({ weight = "regular", muted, style, ...props }: TextProps & { weight?: keyof typeof FONT; muted?: boolean }) {
  const colors = useColors();
  return <Text {...props} style={[{ fontFamily: FONT[weight], color: muted ? colors.mutedForeground : colors.foreground, fontSize: 15 }, style]} />;
}

/**
 * One kitchen page: the title row and the page content, scrollable, with room for the tab bar. Pull down to sync.
 * `floating` sits in the thumb zone above the tab bar, for the page's main button and its snackbar.
 */
export function Screen({ title, facts, actions, floating, children, ref }: {
  title: ReactNode; facts?: ReactNode; actions?: ReactNode; floating?: ReactNode; children: ReactNode; ref?: Ref<ScrollViewInstance>;
}) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView ref={ref} contentContainerStyle={[styles.page, floating ? { paddingBottom: FLOATING_ROOM } : null]} keyboardShouldPersistTaps="handled" refreshControl={<SyncRefresh />}>
        <View style={styles.header}>
          <View style={{ flexShrink: 1 }}>
            {typeof title === "string" ? <T weight="semibold" style={styles.title}>{title}</T> : title}
            {facts ? (typeof facts === "string" ? <T muted style={{ marginTop: 6, fontSize: 14 }}>{facts}</T> : facts) : null}
          </View>
          {actions ? <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>{actions}</View> : null}
        </View>
        {children}
      </ScrollView>
      {floating ? <View pointerEvents="box-none" style={styles.floating}>{floating}</View> : null}
    </View>
  );
}

const FLOATING_ROOM = 104;

/** The main action of a page, in its color. */
export function FloatingButton({ label, icon: Icon, onPress }: { label: string; icon: LucideIcon; onPress: () => void }) {
  const { hue } = usePageColor();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.fab, { backgroundColor: hue, opacity: pressed ? 0.85 : 1 }]}>
      <Icon size={22} color="#ffffff" />
      <T weight="semibold" style={{ color: "#ffffff", fontSize: 16 }}>{label}</T>
    </Pressable>
  );
}

/** What a change did, with the change that takes it back. */
/** A short haptic for a swipe that passes its threshold, or a touch that becomes a hold. */
export function haptic(kind: "threshold" | "hold") {
  if (Platform.OS === "android") void Haptics.performAndroidHapticsAsync(kind === "hold" ? Haptics.AndroidHaptics.Long_Press : Haptics.AndroidHaptics.Segment_Tick);
  else void (kind === "hold" ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium) : Haptics.selectionAsync());
}

export type Notice = Readonly<{ message: string; undo?: readonly QueuedAction[] }>;

const SNACKBAR_MS = 6000;

/** The last notice of a page, above its floating button. It closes after a few seconds, or later when the phone's accessibility settings ask for more time. */
export function Snackbar({ notice, onUndo, onDone }: { notice: Notice | null; onUndo: (action: QueuedAction) => void; onDone: () => void }) {
  const colors = useColors();
  const text = useKitText();
  const { ink: pageInk } = usePageColor();
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!notice) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let live = true;
    void AccessibilityInfo.getRecommendedTimeoutMillis(SNACKBAR_MS).then((ms) => { if (live) timer = setTimeout(() => done.current(), ms); });
    return () => { live = false; clearTimeout(timer); };
  }, [notice]);
  if (!notice) return null;
  return (
    <View accessibilityLiveRegion="polite" style={[styles.snackbar, { backgroundColor: colors.muted, borderColor: colors.border }]}>
      <T style={{ flex: 1, fontSize: 14 }}>{notice.message}</T>
      {notice.undo ? (
        <Pressable accessibilityRole="button" onPress={() => { notice.undo!.forEach(onUndo); onDone(); }} style={styles.snackAction}>
          <T weight="semibold" style={{ color: pageInk }}>{text.undo}</T>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Pull to sync, for the `refreshControl` of a scroll view. Only a pull shows the spinner, because a sync also runs
 * after every change. Android puts the scroll view inside this control, so the props it gets go on to RefreshControl.
 */
export function SyncRefresh(props: Omit<RefreshControlProps, "refreshing" | "onRefresh">) {
  const { sync } = useSync();
  const colors = useColors();
  const { ink: pageInk } = usePageColor();
  const [pulled, setPulled] = useState(false);
  return (
    <RefreshControl {...props} refreshing={pulled} tintColor={pageInk} colors={[pageInk]} progressBackgroundColor={colors.card}
      onRefresh={() => { setPulled(true); void sync().finally(() => setPulled(false)); }} />
  );
}

/** The page icon on a tint of the page color. */
export function HueBadge({ size = 56 }: { size?: number }) {
  const page = useContext(PageContext);
  const Icon = PAGES.find((one) => one.key === page)!.icon;
  const colors = useColors();
  const { ink: pageInk } = usePageColor();
  return (
    <View style={{ width: size, height: size, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: tint(pageInk, 20, colors.background) }}>
      <Icon color={pageInk} size={size * 0.45} />
    </View>
  );
}

/** What an empty page or list says, with the page icon so the page still feels like itself. */
export function Empty({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  const colors = useColors();
  return (
    <View style={[styles.empty, { borderColor: colors.border }]}>
      <HueBadge />
      <T weight="semibold" style={{ fontSize: 18, textAlign: "center" }}>{title}</T>
      {body ? <T muted style={{ fontSize: 14, textAlign: "center", maxWidth: 320 }}>{body}</T> : null}
      {children}
    </View>
  );
}

type ButtonTone = "primary" | "outline" | "ghost" | "destructive";

export function Button({ label, onPress, tone = "primary", icon: Icon, disabled, compact, accessibilityLabel }: {
  label?: string; onPress: () => void; tone?: ButtonTone; icon?: LucideIcon; disabled?: boolean; compact?: boolean; accessibilityLabel?: string;
}) {
  const colors = useColors();
  const { hue } = usePageColor();
  const look = buttonLook(tone, colors, hue);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, compact && { height: 36, paddingHorizontal: label ? 12 : 0, width: label ? undefined : 36 }, look, (pressed || disabled) && { opacity: disabled ? 0.4 : 0.8 }]}
    >
      {Icon ? <Icon size={18} color={look.color} /> : null}
      {label ? <T weight="medium" style={{ color: look.color, fontSize: 15 }}>{label}</T> : null}
    </Pressable>
  );
}

function buttonLook(tone: ButtonTone, colors: Colors, hue: string): ViewStyle & { color: string } {
  switch (tone) {
    case "primary": return { backgroundColor: hue, borderColor: hue, color: "#ffffff" };
    case "outline": return { backgroundColor: colors.control, borderColor: colors.controlBorder, color: colors.foreground };
    case "ghost": return { backgroundColor: "transparent", borderColor: "transparent", color: colors.foreground };
    case "destructive": return { backgroundColor: "transparent", borderColor: colors.controlBorder, color: colors.destructive };
  }
}

export function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" | "warn" }) {
  const colors = useColors();
  const { hue } = usePageColor();
  const look = tone === "accent" ? { bg: hue, fg: "#ffffff" } : tone === "warn" ? { bg: tint(colors.destructive, 12, colors.background), fg: colors.destructive } : { bg: colors.muted, fg: colors.mutedForeground };
  return (
    <View style={{ height: 24, borderRadius: 12, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: look.bg }}>
      <T weight="medium" style={{ fontSize: 12, color: look.fg }}>{children}</T>
    </View>
  );
}

/** A group name in its color, for the heading of a group list. */
export function GroupLabel({ color, children, count }: { color: string; children: ReactNode; count?: number }) {
  const colors = useColors();
  const text = ink(color, colors);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4, marginBottom: 8 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <T weight="semibold" numberOfLines={1} style={{ color: text, flexShrink: 1 }}>{children}</T>
      {count ? <T weight="medium" style={{ color: text, opacity: 0.75, fontSize: 14 }}>{count}</T> : null}
    </View>
  );
}

/** A list of one food group: a light panel of its color, with lines in its color between the rows. */
export function GroupList({ color, children }: { color: string; children: ReactNode }) {
  const colors = useColors();
  const rows = Array.isArray(children) ? children.flat().filter(Boolean) : [children];
  return (
    <View style={{ borderRadius: 16, overflow: "hidden", backgroundColor: tint(color, 11, colors.card) }}>
      {rows.map((row, index) => (
        <View key={index} style={index ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tint(color, 22, colors.card) } : undefined}>{row}</View>
      ))}
    </View>
  );
}

export function GroupDot({ groups, group, size = 10 }: { groups: readonly string[]; group: string; size?: number }) {
  const colors = useColors();
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: groupColor(colors, groups, group) }} />;
}

/** A plate ring: one circle split into the food groups of a dish, a week, or a list. Each group gets an arc as long as its share. */
export function PlateRing({ groups, sections, size = 32 }: { groups: readonly string[]; sections: readonly string[]; size?: number }) {
  const colors = useColors();
  const parts = byGroup(groups, sections, (section) => section);
  const circumference = 2 * Math.PI * 14.5;
  let offset = 0;
  return (
    <Svg width={size} height={size} viewBox="0 0 36 36">
      <Circle r={14.5} cx={18} cy={18} fill="none" strokeWidth={6} stroke={colors.muted} />
      {sections.length ? parts.map(([group, items]) => {
        const length = (items.length / sections.length) * circumference;
        const arc = <Circle key={group} r={14.5} cx={18} cy={18} fill="none" strokeWidth={6} stroke={groupColor(colors, groups, group)} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} rotation={-90} origin="18, 18" />;
        offset += length;
        return arc;
      }) : null}
    </Svg>
  );
}

/** A bottom sheet in the color of the open page, like the web Kitchen sheets on a phone. */
export function Sheet({ open, onClose, title, description, children, footer }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const text = useKitText();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={text.close}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} />
        </Pressable>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 16 }]}>
          <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.controlBorder, marginBottom: 12 }} />
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <T weight="semibold" style={{ fontSize: 20 }}>{title}</T>
              {description ? <T muted style={{ fontSize: 14, marginTop: 4 }}>{description}</T> : null}
            </View>
            <Button tone="ghost" compact icon={X} onPress={onClose} accessibilityLabel={text.close} />
          </View>
          <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: 12, paddingVertical: 12 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          {footer ? <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Stepper({ value, onValue, min = 1, max = 100, label, unit }: { value: number; onValue: (value: number) => void; min?: number; max?: number; label: string; unit?: string }) {
  const colors = useColors();
  const text = useKitText();
  const step = (next: number, disabled: boolean, sign: string, a11y: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} disabled={disabled} onPress={() => onValue(next)} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.4 : 1 }}>
      <T style={{ fontSize: 20 }}>{sign}</T>
    </Pressable>
  );
  return (
    <View accessibilityLabel={label} style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", borderRadius: 22, borderWidth: 1, borderColor: colors.controlBorder, backgroundColor: colors.control }}>
      {step(Math.max(min, value - 1), value <= min, "−", text.fewer(label))}
      <T weight="semibold" style={{ minWidth: 36, textAlign: "center" }}>{value}{unit ? <T muted> {unit}</T> : null}</T>
      {step(Math.min(max, value + 1), value >= max, "+", text.more(label))}
    </View>
  );
}

/** A text field in the web control style. */
export function Field({ style, ...props }: TextInputProps) {
  const colors = useColors();
  return <TextInput placeholderTextColor={colors.mutedForeground} {...props} style={[styles.field, { borderColor: colors.controlBorder, backgroundColor: colors.control, color: colors.foreground }, style]} />;
}

export function SearchField({ value, onValue, label }: { value: string; onValue: (value: string) => void; label: string }) {
  const colors = useColors();
  const text = useKitText();
  return (
    <View style={[styles.field, { flexDirection: "row", alignItems: "center", gap: 8, borderColor: colors.controlBorder, backgroundColor: colors.control, paddingRight: 4 }]}>
      <Search size={18} color={colors.mutedForeground} />
      <TextInput value={value} onChangeText={onValue} placeholder={label} accessibilityLabel={label} placeholderTextColor={colors.mutedForeground} style={{ flex: 1, color: colors.foreground, fontFamily: FONT.regular, fontSize: 16 }} />
      {value ? <Button tone="ghost" compact icon={X} onPress={() => onValue("")} accessibilityLabel={text.clearSearch} /> : null}
    </View>
  );
}

const DATE_FORMATS = Object.fromEntries((["en", "de"] as const).map((language) => [language, {
  weekday: new Intl.DateTimeFormat(LOCALES[language], { weekday: "short", timeZone: "UTC" }),
  weekdayLong: new Intl.DateTimeFormat(LOCALES[language], { weekday: "long", timeZone: "UTC" }),
  dayMonth: new Intl.DateTimeFormat(LOCALES[language], { day: "numeric", month: "short", timeZone: "UTC" })
}])) as Record<KitchenLanguage, Record<"weekday" | "weekdayLong" | "dayMonth", Intl.DateTimeFormat>>;

export function dayParts(day: string, language: KitchenLanguage) {
  const date = new Date(`${day}T00:00:00Z`);
  const format = DATE_FORMATS[language];
  return { weekday: format.weekday.format(date), weekdayLong: format.weekdayLong.format(date), number: date.getUTCDate(), dayMonth: format.dayMonth.format(date) };
}

export function weekRange(start: string, language: KitchenLanguage): string {
  return TEXT[language].range(dayParts(start, language).dayMonth, dayParts(addDays(start, 6), language).dayMonth);
}

export function weekLabel(start: string, today: string, language: KitchenLanguage): string {
  const text = TEXT[language];
  const thisWeek = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  if (start === thisWeek) return text.thisWeek;
  if (start === addDays(thisWeek, 7)) return text.nextWeek;
  if (start === addDays(thisWeek, -7)) return text.lastWeek;
  return weekRange(start, language);
}

export function useByLabel(useBy: string, today: string, language: KitchenLanguage): { text: string; urgent: boolean } {
  const text = TEXT[language];
  const parts = dayParts(useBy, language);
  const days = Math.round((Date.parse(`${useBy}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return { text: text.pastUseBy(parts.dayMonth), urgent: true };
  if (days === 0) return { text: text.useToday, urgent: true };
  if (days === 1) return { text: text.useTomorrow, urgent: true };
  return { text: text.useBy(`${parts.weekday} ${parts.dayMonth}`), urgent: false };
}

/** The name to show for a group. Kitchens name their own groups, so only the fallback group is translated. */
export function groupLabel(group: string, language: KitchenLanguage): string {
  return group === UNSORTED_SECTION ? TEXT[language].other : group;
}

/** Items in the kitchen's group order, keyed by group. */
export function byGroup<T>(groups: readonly string[], items: readonly T[], groupOf: (item: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(groupOf(item), [...(map.get(groupOf(item)) ?? []), item]);
  const order = byGroupOrder(groups);
  return [...map].sort(([a], [b]) => order(a, b));
}

/** The group that most of a dish's ingredients belong to, which tints its tile. */
export function mainGroup(groups: readonly string[], sections: readonly string[]): string | undefined {
  return byGroup(groups, sections, (section) => section).sort(([, a], [, b]) => b.length - a.length)[0]?.[0];
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 16 },
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 },
  title: { fontSize: 32, lineHeight: 34, letterSpacing: -0.6 },
  empty: { alignItems: "center", gap: 12, borderWidth: 1, borderStyle: "dashed", borderRadius: 16, paddingHorizontal: 24, paddingVertical: 40 },
  button: { height: 44, paddingHorizontal: 16, borderRadius: RADIUS, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 10 },
  field: { minHeight: 44, borderWidth: 1, borderRadius: RADIUS, paddingHorizontal: 12, fontFamily: FONT.regular, fontSize: 16 },
  floating: { position: "absolute", left: 16, right: 16, bottom: 16, alignItems: "flex-end", gap: 10 },
  fab: { height: 56, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, borderRadius: 16, elevation: 6, shadowColor: "#000000", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  snackbar: { alignSelf: "stretch", minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, elevation: 4, shadowColor: "#000000", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  snackAction: { minHeight: 48, minWidth: 64, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 }
});
