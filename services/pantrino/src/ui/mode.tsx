import * as SecureStore from "expo-secure-store";
import type { BodyshopAppSnapshot } from "@tools-platform/service/bodyshop-contract";
import { ChefHat, HeartPulse } from "lucide-react-native";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { type HostInstance, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { bodyStore } from "../body/store";
import { useBodyshop, useKitchen } from "../state";
import { haptic } from "./haptics";
import { Button, type Mode, type Notice, Press, Sheet, T, TABS, TabChromeContext, useKitText } from "./kit";
import { type KitchenLanguage, useText } from "./language";
import { type PageKey, tint, useColors } from "./theme";
import { nextMealToday } from "./today/model";

const MODE_KEY = "pantrino.mode";
const FIRST: Record<Mode, string> = { kitchen: "index", body: "body" };
const MODE_PAGE: Record<Mode, PageKey> = { kitchen: "today", body: "foods" };
const OTHER: Record<Mode, Mode> = { kitchen: "body", body: "kitchen" };
const GROW_MS = 260;
/** The other mode opens under the color while it grows, so its first frame is ready when the color fades. */
const NAVIGATE_MS = 120;
/** A switch that never arrives (Bodyshop went away during it) still clears the color. */
const GIVE_UP_MS = 1200;
const MIN_NAME = 40;
const modeOf = (route: string): Mode => TABS.find((one) => one.route === route)?.mode ?? "kitchen";

type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;
type ModeSwitch = Readonly<{ mode: Mode; open: (mode: Mode, from?: Rect) => void; hide: () => void }>;
type Bar = Readonly<{ navigate: { current: (route: string) => void }; track: (route: string) => void }>;

const ModeContext = createContext<ModeSwitch | null>(null);
const BarContext = createContext<Bar | null>(null);

function savedMode(): Mode {
  try { return SecureStore.getItem(MODE_KEY) === "body" ? "body" : "kitchen"; } catch { return "kitchen"; }
}

/**
 * Kitchen and Body share one tab navigator. This keeps the last tab of each mode, opens the mode used last, and leaves
 * Body when Bodyshop is gone. A switch from the pill grows the pill's color over the screen, then opens the other mode.
 */
export function ModeProvider({ children }: { children: ReactNode }) {
  const colors = useColors();
  const text = useText(TEXT);
  const kitText = useKitText();
  const { access, snapshot, setShown } = useBodyshop();
  const reduce = useReducedMotion();
  const [mode, setMode] = useState<Mode>("kitchen");
  const [notice, setNotice] = useState<Notice | null>(null);
  const last = useRef<Record<Mode, string>>({ ...FIRST });
  const navigate = useRef((_route: string) => undefined as void);
  const started = useRef(false);
  const announce = useRef(false);
  const arriving = useRef<{ mode: Mode; at: number } | null>(null);
  const frame = useRef<HostInstance>(null);
  const from = useSharedValue<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const size = useSharedValue({ width: 0, height: 0 });
  const grow = useSharedValue(0);
  const shade = useSharedValue(0);
  const tone = useSharedValue(colors.background);
  const go = (next: Mode) => navigate.current(last.current[next]);
  const reveal = (after: number) => { shade.value = withDelay(after, withTiming(0, { duration: 200 })); };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (access === "shown" && savedMode() === "body") go("body");
  }, []);
  // The synchronous write blocks the JS thread on Android for about half a second, so the mode is saved in the background.
  useEffect(() => { void SecureStore.setItemAsync(MODE_KEY, mode).catch(() => undefined); }, [mode]);
  useEffect(() => { if (mode === "body" && access !== "shown") go("kitchen"); }, [mode, access]);
  // Body can leave the shared day on another date. Kitchen shows today's calories, so it brings the day back to today.
  useEffect(() => { if (mode === "kitchen" && snapshot && snapshot.day !== snapshot.today) void bodyStore.refresh(snapshot.today); }, [mode, snapshot]);
  useEffect(() => {
    const switching = arriving.current;
    if (switching?.mode !== mode) return;
    arriving.current = null;
    reveal(Math.max(0, GROW_MS - (Date.now() - switching.at)));
  }, [mode]);
  // The notice waits for Kitchen, because leaving Body closes the notices of the Body page.
  useEffect(() => {
    if (!announce.current || mode !== "kitchen" || access !== "hidden") return;
    announce.current = false;
    setNotice({ message: text.hidden, action: { label: kitText.undo, run: () => setShown(true) } });
  }, [mode, access]);

  const bar = useMemo<Bar>(() => ({
    navigate,
    track(route) {
      const next = modeOf(route);
      last.current[next] = route;
      setMode(next);
    },
  }), []);
  const switcher: ModeSwitch = {
    mode,
    open(next, rect) {
      if (next === mode) return;
      const view = frame.current;
      if (!rect || reduce || !view) return go(next);
      view.measureInWindow((x, y, width, height) => {
        from.value = { x: rect.x - x, y: rect.y - y, width: rect.width, height: rect.height };
        size.value = { width, height };
        tone.value = tint(colors.pageInk[MODE_PAGE[next]], 16, colors.background);
        grow.value = 0;
        shade.value = 1;
        grow.value = withTiming(1, { duration: GROW_MS, easing: Easing.bezier(0.3, 0, 0.2, 1) });
        const switching = { mode: next, at: Date.now() };
        arriving.current = switching;
        setTimeout(() => go(next), NAVIGATE_MS);
        setTimeout(() => { if (arriving.current === switching) { arriving.current = null; reveal(0); } }, GIVE_UP_MS);
      });
    },
    hide() {
      announce.current = true;
      setShown(false);
    },
  };
  const chrome = useMemo(() => ({ pill: access === "shown" ? <ModePill /> : null, notice, clearNotice: () => setNotice(null) }), [access, notice]);
  const growing = useAnimatedStyle(() => {
    const start = from.value;
    const p = grow.value;
    return {
      left: start.x * (1 - p),
      top: start.y * (1 - p),
      width: start.width + (size.value.width - start.width) * p,
      height: start.height + (size.value.height - start.height) * p,
      borderRadius: (start.height / 2) * (1 - p),
      opacity: shade.value,
      backgroundColor: tone.value,
    };
  });

  return (
    <ModeContext value={switcher}>
      <BarContext value={bar}>
        <TabChromeContext value={chrome}>
          <View ref={frame} collapsable={false} style={{ flex: 1 }}>
            {children}
            <Animated.View pointerEvents="none" style={[styles.shade, growing]} />
          </View>
        </TabChromeContext>
      </BarContext>
    </ModeContext>
  );
}

/** The tab bar reports the open tab and lends its navigation, so the pill can open each mode's last tab. */
export function useModeBar(route: string, navigate: (route: string) => void) {
  const bar = useContext(BarContext);
  if (bar) bar.navigate.current = navigate;
  useEffect(() => { bar?.track(route); }, [bar, route]);
}

/** One live fact from the other mode. A tap opens that mode. A hold offers to hide Bodyshop. */
function ModePill() {
  const switcher = useContext(ModeContext);
  const colors = useColors();
  const text = useText(TEXT);
  const { snapshot } = useBodyshop();
  const kitchen = useKitchen();
  const [holding, setHolding] = useState(false);
  const [cramped, setCramped] = useState("");
  const { width } = useWindowDimensions();
  const self = useRef<HostInstance>(null);
  if (!switcher) return null;
  const next = OTHER[switcher.mode];
  const name = next === "body" ? text.bodyshop : text.kitchen;
  const fact: Fact = next === "body" ? kcalFact(snapshot, text) : { lead: (kitchen && nextMealToday(kitchen.kitchen, kitchen.today)?.recipe) || text.kitchen };
  const ink = colors.pageInk[MODE_PAGE[next]];
  // A name cut to a letter or two says nothing, so the pill shows only its icon until the window or the name changes.
  const place = `${width}:${fact.lead}`;
  const Icon = next === "body" ? HeartPulse : ChefHat;
  const open = () => self.current?.measureInWindow((x, y, width, height) => switcher.open(next, { x, y, width, height }));
  const hold = () => { haptic("hold"); setHolding(true); };

  return (
    <View ref={self} collapsable={false} style={styles.slot}>
      <Press accessibilityRole="button" accessibilityLabel={`${text.open(name)}, ${[fact.lead, fact.tail].filter(Boolean).join(" ")}`} feel="toggle"
        accessibilityActions={[{ name: "longpress", label: text.hide }]}
        onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === "longpress") hold(); }}
        onPress={open} onLongPress={hold}
        style={({ pressed }) => [styles.pill, { backgroundColor: tint(ink, 16, colors.background), opacity: pressed ? 0.7 : 1 }]}>
        {fact.tail
          ? <View style={styles.parts}>
              <View style={[styles.part, { marginRight: 2 }]}><Icon size={16} color={ink} /></View>
              {[fact.lead, fact.tail].map((part) => <View key={part} style={styles.part}><T weight="semibold" maxFontSizeMultiplier={1.3} style={styles.fact}>{part}</T></View>)}
            </View>
          : <><Icon size={16} color={ink} />{cramped === place ? null
            : <T weight="semibold" numberOfLines={1} maxFontSizeMultiplier={1.3} style={[styles.fact, { flexShrink: 1 }]}
              onLayout={(event) => { if (event.nativeEvent.layout.width < MIN_NAME) setCramped(place); }}>{fact.lead}</T>}</>}
      </Press>
      <Sheet open={holding} onClose={() => setHolding(false)} title={text.bodyshop} description={text.hideBody}
        footer={<View style={styles.footer}>
          <Button tone="outline" label={text.hide} onPress={() => { setHolding(false); switcher.hide(); }} />
          <Button label={text.open(name)} onPress={() => { setHolding(false); switcher.open(next); }} />
        </View>}>{null}</Sheet>
    </View>
  );
}

/** A number shows whole or not at all, so a fact with a tail drops whole parts when the pill is narrow. */
type Fact = Readonly<{ lead: string; tail?: string }>;

function kcalFact(snapshot: BodyshopAppSnapshot | null, text: typeof en): Fact {
  if (!snapshot || snapshot.day !== snapshot.today) return { lead: text.bodyshop };
  const left = Math.round(snapshot.targets.kcal - snapshot.entries.reduce((sum, one) => sum + (one.nutrients.kcal ?? 0), 0));
  return { lead: `${Math.abs(left)} kcal`, tail: left >= 0 ? text.left : text.over };
}

const en = {
  bodyshop: "Bodyshop",
  kitchen: "Kitchen",
  left: "left",
  over: "over",
  open: (name: string) => `Open ${name}`,
  hide: "Hide Bodyshop",
  hideBody: "Hide it if you do not use it. You can turn it on again in Profile.",
  hidden: "Bodyshop is hidden. Turn it on in Profile.",
};
const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: {
    bodyshop: "Bodyshop",
    kitchen: "Küche",
    left: "übrig",
    over: "zu viel",
    open: (name: string) => `${name} öffnen`,
    hide: "Bodyshop ausblenden",
    hideBody: "Blende ihn aus, wenn du ihn nicht nutzt. In Profil schaltest du ihn wieder ein.",
    hidden: "Bodyshop ist ausgeblendet. In Profil schaltest du ihn wieder ein.",
  },
};

const styles = StyleSheet.create({
  // The pill gives way before a long title does. It shrinks to its icon first.
  slot: { flexShrink: 20, minWidth: 48, maxWidth: 148 },
  pill: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 18, overflow: "hidden" },
  // Each part is one full line tall, so a part that does not fit wraps onto a second line that the box hides.
  parts: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", columnGap: 4, height: 36, overflow: "hidden", flexShrink: 1 },
  part: { height: 36, justifyContent: "center", flexShrink: 0 },
  fact: { fontSize: 13 },
  footer: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  shade: { position: "absolute" },
});
