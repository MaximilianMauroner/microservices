import { byGroupOrder, addDays, UNSORTED_SECTION } from "@tools-platform/service/kitchen-contract";
import * as Haptics from "expo-haptics";
import { BookOpen, CalendarDays, ChevronLeft, ChevronRight, CookingPot, type LucideIcon, Refrigerator, Search, ShoppingBasket, X } from "lucide-react-native";
import { useFocusEffect } from "expo-router";
import { createContext, type ReactNode, type Ref, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, type RefreshControlProps, ScrollView, type ScrollViewInstance, StyleSheet, Text, type TextProps, TextInput, type TextInputProps, View, type ViewStyle } from "react-native";
import { GestureDetector, GestureHandlerRootView, usePanGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";
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
  previousWeek: "Previous week",
  lastWeek: "Last week",
  range: (from: string, to: string) => `${from} to ${to}`,
  pastUseBy: (day: string) => `Past use-by (${day})`,
  useToday: "Use today",
  useTomorrow: "Use by tomorrow",
  useBy: (day: string) => `Use by ${day}`,
  other: "Other",
  clearSearch: "Clear search",
  actionsFor: (name: string) => `Actions for ${name}`,
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
    previousWeek: "Vorherige Woche",
    lastWeek: "Letzte Woche",
    range: (from: string, to: string) => `${from} bis ${to}`,
    pastUseBy: (day: string) => `Abgelaufen (${day})`,
    useToday: "Heute verbrauchen",
    useTomorrow: "Bis morgen verbrauchen",
    useBy: (day: string) => `Verbrauchen bis ${day}`,
    other: "Sonstiges",
    clearSearch: "Suche löschen",
    actionsFor: (name: string) => `Aktionen für ${name}`,
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
  return <Text textBreakStrategy="balanced" {...props} style={[{ fontFamily: FONT[weight], color: muted ? colors.mutedForeground : colors.foreground, fontSize: 15 }, style]} />;
}

/**
 * One kitchen page: the title row and the page content, scrollable, with room for the tab bar. Pull down to sync.
 * `back` puts the way back above the title, where phone apps keep it. A tab page puts its one main action in `fab`,
 * a floating button above the tab bar. A page opened from a tab hides the tab bar and puts its actions in `toolbar`,
 * docked at the bottom (Material 3 shows a toolbar and the tab bar never together). `floating` holds the snackbar.
 */
export function Screen({ title, facts, actions, back, fab, toolbar, floating, children, ref }: {
  title: ReactNode; facts?: ReactNode; actions?: ReactNode; back?: { label: string; onPress: () => void }; fab?: ReactNode; toolbar?: ReactNode; floating?: ReactNode; children: ReactNode; ref?: Ref<ScrollViewInstance>;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1 }}>
        <ScrollView ref={ref} contentContainerStyle={[styles.page, fab ? { paddingBottom: FAB_ROOM } : null]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" refreshControl={<SyncRefresh />}>
          {back ? (
            <Pressable accessibilityRole="button" accessibilityLabel={back.label} onPress={back.onPress} hitSlop={8}
              style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}>
              <ChevronLeft size={24} color={colors.foreground} />
              <T weight="medium" style={{ fontSize: 16 }}>{back.label}</T>
            </Pressable>
          ) : null}
          <View style={styles.header}>
            <View style={{ flexShrink: 1 }}>
              {typeof title === "string" ? <T weight="semibold" style={styles.title}>{title}</T> : title}
              {facts ? (typeof facts === "string" ? <T muted style={{ marginTop: 6, fontSize: 14 }}>{facts}</T> : facts) : null}
            </View>
            {actions ? <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>{actions}</View> : null}
          </View>
          {children}
        </ScrollView>
        {toolbar ? (
          <Svg pointerEvents="none" width="100%" height={FADE} style={styles.fade}>
            <Defs><LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={colors.background} stopOpacity={0} /><Stop offset="1" stopColor={colors.background} stopOpacity={1} /></LinearGradient></Defs>
            <Rect width="100%" height={FADE} fill="url(#fade)" />
          </Svg>
        ) : null}
        {floating || fab ? <View pointerEvents="box-none" style={styles.floating}>{floating}{fab}</View> : null}
      </View>
      {toolbar ? <View style={[styles.toolbar, { borderTopColor: colors.border, backgroundColor: colors.card, paddingBottom: 12 + insets.bottom }]}>{toolbar}</View> : null}
    </View>
  );
}

/** The height of the fade over the end of the visible content, above the toolbar. */
const FADE = 40;

/** The height of the fade where sheet content scrolls under the sheet footer. */
const SHEET_FADE = 28;

/** Room under the content of a tab page, so its last row can scroll above the floating button. */
const FAB_ROOM = 96;

/** The one main action of a tab page: an extended floating action button at the end, above the tab bar. */
export function FloatingButton({ label, icon: Icon, onPress }: { label: string; icon: LucideIcon; onPress: () => void }) {
  const { hue } = usePageColor();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.fab, { backgroundColor: hue, opacity: pressed ? 0.85 : 1 }]}>
      <Icon size={22} color="#ffffff" />
      <T weight="semibold" style={{ color: "#ffffff", fontSize: 16 }}>{label}</T>
    </Pressable>
  );
}

/** An action in a docked toolbar. The actions share the width of the toolbar. */
export function ToolbarButton({ label, icon: Icon, onPress, tone = "primary" }: { label: string; icon: LucideIcon; onPress: () => void; tone?: "primary" | "outline" }) {
  const colors = useColors();
  const { hue } = usePageColor();
  const look = buttonLook(tone, colors, hue);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => [styles.toolbarButton, look, pressed && { opacity: 0.8 }]}>
      <Icon size={20} color={look.color} />
      <T weight="semibold" textBreakStrategy="simple" style={{ color: look.color, fontSize: 16 }}>{label}</T>
    </Pressable>
  );
}

/** The previous and next week arrows, for the title row of a week page. */
export function WeekNav({ canGoBack, onStep }: { canGoBack: boolean; onStep: (step: -1 | 1) => void }) {
  const colors = useColors();
  const text = useKitText();
  return (
    <View style={[styles.weekNav, { borderColor: colors.controlBorder, backgroundColor: colors.control }]}>
      {([[-1, ChevronLeft, text.previousWeek], [1, ChevronRight, text.nextWeek]] as const).map(([step, Icon, label]) => {
        const disabled = step === -1 && !canGoBack;
        return (
          <Pressable key={step} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={() => onStep(step)}
            style={({ pressed }) => [styles.weekStep, { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}>
            <Icon size={22} color={colors.foreground} />
          </Pressable>
        );
      })}
    </View>
  );
}

export function haptic(kind: "threshold" | "hold") {
  if (Platform.OS === "android") void Haptics.performAndroidHapticsAsync(kind === "hold" ? Haptics.AndroidHaptics.Long_Press : Haptics.AndroidHaptics.Segment_Tick);
  else void (kind === "hold" ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium) : Haptics.selectionAsync());
}

export type Notice = Readonly<{ message: string; undo?: readonly QueuedAction[] }>;

const SNACKBAR_MS = 6000;

/**
 * The last notice of a page, above its floating button. A notice with Undo stays until the user acts, swipes it away,
 * makes the next change, or leaves the page (Material 3: snackbars with actions do not close by themselves). A notice
 * without an action closes after a few seconds, or later when the phone's accessibility settings ask for more time.
 */
export function Snackbar({ notice, onUndo, onDone }: { notice: Notice | null; onUndo: (action: QueuedAction) => void; onDone: () => void }) {
  const colors = useColors();
  const text = useKitText();
  const { ink: pageInk } = usePageColor();
  const done = useRef(onDone);
  done.current = onDone;
  useFocusEffect(useCallback(() => () => done.current(), []));
  useEffect(() => {
    if (!notice || notice.undo) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let live = true;
    void AccessibilityInfo.getRecommendedTimeoutMillis(SNACKBAR_MS).then((ms) => { if (live) timer = setTimeout(() => done.current(), ms); });
    return () => { live = false; clearTimeout(timer); };
  }, [notice]);
  const shift = useSharedValue(0);
  useEffect(() => { shift.value = 0; }, [notice, shift]);
  const away = usePanGesture({
    activeOffsetX: [-12, 12],
    failOffsetY: [-12, 12],
    onUpdate: (event) => { shift.value = event.translationX; },
    onDeactivate: (event) => {
      if (!event.canceled && (Math.abs(event.translationX) > SNACKBAR_AWAY.distance || Math.abs(event.velocityX) > SNACKBAR_AWAY.velocity)) {
        shift.value = withTiming(Math.sign(event.translationX || event.velocityX) * 600, { duration: 160 });
        scheduleOnRN(onDone);
      } else shift.value = withSpring(0, { damping: 20, stiffness: 240 });
    },
  });
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: shift.value }], opacity: 1 - Math.min(Math.abs(shift.value) / 400, 0.6) }));
  if (!notice) return null;
  return (
    <GestureDetector gesture={away}>
      <Animated.View accessibilityLiveRegion="polite" style={[styles.snackbar, { backgroundColor: colors.muted, borderColor: colors.border }, slide]}>
        <T style={{ flex: 1, fontSize: 14 }}>{notice.message}</T>
        {notice.undo ? (
          <Pressable accessibilityRole="button" onPress={() => { notice.undo!.forEach(onUndo); onDone(); }} style={styles.snackAction}>
            <T weight="semibold" style={{ color: pageInk }}>{text.undo}</T>
          </Pressable>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

/** How far sideways, or how fast, a drag on the snackbar must go for the release to close it. */
const SNACKBAR_AWAY = { distance: 80, velocity: 800 };

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

export function Button({ label, onPress, tone = "primary", icon: Icon, disabled, compact, wide, accessibilityLabel }: {
  label?: string; onPress: () => void; tone?: ButtonTone; icon?: LucideIcon; disabled?: boolean; compact?: boolean; wide?: boolean; accessibilityLabel?: string;
}) {
  const colors = useColors();
  const { hue } = usePageColor();
  const look = disabled ? disabledLook(tone, colors, hue) : buttonLook(tone, colors, hue);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      accessibilityState={{ disabled }}
      hitSlop={compact ? 4 : undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.button, wide && styles.wide, compact && { height: 40, paddingHorizontal: label ? 12 : 0, width: label ? undefined : 40 }, look, pressed && { opacity: 0.8 }]}
    >
      {Icon ? <Icon size={18} color={look.color} /> : null}
      {label ? <T weight="medium" style={{ color: look.color, fontSize: 15 }}>{label}</T> : null}
    </Pressable>
  );
}

/** A disabled button in the Material 3 colors: the text at 38 percent and a filled button's container at 12 percent of the text color. */
function disabledLook(tone: ButtonTone, colors: Colors, hue: string): ViewStyle & { color: string } {
  const container = tint(colors.foreground, 12, colors.background);
  const content = tint(colors.foreground, 38, colors.background);
  if (tone === "primary") return { backgroundColor: container, borderColor: container, color: content };
  return { backgroundColor: "transparent", borderColor: container, color: content };
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

/** How far down, or how fast, a drag on the sheet top must go for the release to close the sheet. */
const SHEET_CLOSE = { distance: 120, velocity: 900 };

/**
 * A bottom sheet in the color of the open page, like the web Kitchen sheets on a phone. A drag down on its handle
 * and title closes it. The drag starts only there, so it never fights the scroll of the sheet content.
 */
/** `onDismiss` runs on iOS once the sheet has fully closed, so a following sheet can open. */
export function Sheet({ open, onClose, onDismiss, title, description, children, footer }: { open: boolean; onClose: () => void; onDismiss?: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const text = useKitText();
  const drop = useSharedValue(0);
  useEffect(() => { if (open) drop.value = 0; }, [open, drop]);
  const drag = usePanGesture({
    activeOffsetY: 8,
    failOffsetX: [-24, 24],
    onUpdate: (event) => { drop.value = Math.max(0, event.translationY); },
    onDeactivate: (event) => {
      if (!event.canceled && (event.translationY > SHEET_CLOSE.distance || event.velocityY > SHEET_CLOSE.velocity)) scheduleOnRN(onClose);
      else drop.value = withSpring(0, { damping: 20, stiffness: 240 });
    },
  });
  const follow = useAnimatedStyle(() => ({ transform: [{ translateY: drop.value }] }));
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} onDismiss={onDismiss}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "flex-end" }}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={text.close}>
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} />
          </Pressable>
          <Animated.View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 16 }, follow]}>
            <GestureDetector gesture={drag}>
              <View style={{ paddingTop: 10 }}>
                <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.controlBorder, marginBottom: 12 }} />
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <T weight="semibold" style={{ fontSize: 20 }}>{title}</T>
                    {description ? <T muted textBreakStrategy="simple" style={{ fontSize: 14, marginTop: 4 }}>{description}</T> : null}
                  </View>
                  <Button tone="ghost" compact icon={X} onPress={onClose} accessibilityLabel={text.close} />
                </View>
              </View>
            </GestureDetector>
            <View style={{ flexShrink: 1 }}>
              <ScrollView contentContainerStyle={{ gap: 12, paddingTop: 12, paddingBottom: footer ? 28 : 12 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
              {footer ? (
                <Svg pointerEvents="none" width="100%" height={SHEET_FADE} style={styles.fade}>
                  <Defs><LinearGradient id="sheetFade" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={colors.card} stopOpacity={0} /><Stop offset="1" stopColor={colors.card} stopOpacity={1} /></LinearGradient></Defs>
                  <Rect width="100%" height={SHEET_FADE} fill="url(#sheetFade)" />
                </Svg>
              ) : null}
            </View>
            {footer ? <View style={[styles.sheetFooter, { borderTopColor: colors.border }]}>{footer}</View> : null}
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

export function Stepper({ value, onValue, min = 1, max = 100, label, unit }: { value: number; onValue: (value: number) => void; min?: number; max?: number; label: string; unit?: string }) {
  const colors = useColors();
  const text = useKitText();
  const step = (next: number, disabled: boolean, sign: string, a11y: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} disabled={disabled} onPress={() => onValue(next)} style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.4 : 1 }}>
      <T style={{ fontSize: 20 }}>{sign}</T>
    </Pressable>
  );
  return (
    <View accessibilityLabel={label} style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", borderRadius: 24, borderWidth: 1, borderColor: colors.controlBorder, backgroundColor: colors.control }}>
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
  wide: { flexGrow: 1, height: 52 },
  button: { height: 48, paddingHorizontal: 16, borderRadius: RADIUS, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  sheet: { maxHeight: "92%", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16 },
  sheetFooter: { flexDirection: "row", gap: 8, justifyContent: "flex-end", marginHorizontal: -16, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  back: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", minHeight: 48, marginLeft: -6, marginBottom: -8 },
  field: { minHeight: 48, borderWidth: 1, borderRadius: RADIUS, paddingHorizontal: 12, fontFamily: FONT.regular, fontSize: 16 },
  fade: { position: "absolute", left: 0, right: 0, bottom: 0 },
  floating: { position: "absolute", left: 16, right: 16, bottom: 16, alignItems: "flex-end", gap: 12 },
  fab: { height: 56, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, borderRadius: 16, elevation: 6, shadowColor: "#000000", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  toolbar: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth },
  toolbarButton: { flex: 1, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 12, borderRadius: RADIUS, borderWidth: 1 },
  weekNav: { height: 48, flexDirection: "row", borderRadius: RADIUS, borderWidth: 1, overflow: "hidden" },
  weekStep: { width: 48, alignItems: "center", justifyContent: "center" },
  snackbar: { alignSelf: "stretch", minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, elevation: 4, shadowColor: "#000000", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  snackAction: { minHeight: 48, minWidth: 64, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 }
});
