import * as SecureStore from "expo-secure-store";
import { Tabs } from "expo-router";
import { ChefHat, HeartPulse } from "lucide-react-native";
import { type ComponentProps, useEffect, useRef } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useBody } from "../../body/store";
import { useApp } from "../../state";
import { type Mode, Press, T, TABS, useKitText } from "../../ui/kit";
import { tint, useColors } from "../../ui/theme";
import { ContentLayoutContext, useContentLayout, useWindowLayout } from "../../ui/responsive";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const MODE_KEY = "pantrino.mode";
const MODE_ICONS = { kitchen: ChefHat, body: HeartPulse } as const;
const FIRST: Record<Mode, string> = { kitchen: "index", body: "body" };

function savedMode(): Mode {
  try { return SecureStore.getItem(MODE_KEY) === "body" ? "body" : "kitchen"; } catch { return "kitchen"; }
}

/** Kitchen and Body share one tab navigator, so each tab keeps its place while the other mode is open. */
export default function KitchenTabs() {
  const colors = useColors();
  const layout = useWindowLayout(true);
  return (
    <ContentLayoutContext value={layout}>
      <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.background }}>
        <Tabs backBehavior="history" screenOptions={{ headerShown: false, tabBarPosition: layout.navigation === "rail" ? "left" : "bottom", sceneStyle: { backgroundColor: colors.background } }} tabBar={(props) => <TabBar {...props} />}>
          {TABS.map((one) => <Tabs.Screen key={one.key} name={one.route} />)}
        </Tabs>
      </SafeAreaView>
    </ContentLayoutContext>
  );
}

function TabBar({ state, navigateToTab }: TabBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const text = useKitText();
  const layout = useContentLayout();
  const { session } = useApp();
  const { status } = useBody();
  const rail = layout.navigation === "rail";
  const current = TABS.find((one) => one.route === state.routes[state.index]?.name) ?? TABS[0];
  const mode = current.mode;
  const canSwitch = session === "signed-in" && status !== "no-access";
  const last = useRef<Record<Mode, string>>({ ...FIRST });
  last.current[mode] = current.route;
  const go = (name: string) => { const route = state.routes.find((one) => one.name === name); if (route) navigateToTab(route.key); };

  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (canSwitch && savedMode() === "body") go(FIRST.body);
  }, []);
  useEffect(() => {
    try { SecureStore.setItem(MODE_KEY, mode); } catch { /* The mode is a convenience. The next launch opens Kitchen. */ }
  }, [mode]);
  useEffect(() => { if (mode === "body" && !canSwitch) go(FIRST.kitchen); }, [mode, canSwitch]);

  return (
    <ScrollView horizontal={!rail} scrollEnabled={rail} scrollsToTop={false} showsVerticalScrollIndicator={false}
      style={rail ? { width: layout.railWidth, flexGrow: 0, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border } : { flexGrow: 0 }}
      contentContainerStyle={[styles.bar, rail && styles.rail, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: insets.bottom }]}>
      {canSwitch ? <>
        <Press accessibilityRole="switch" accessibilityLabel={text.bodyMode} accessibilityState={{ checked: mode === "body" }}
          onPress={() => go(last.current[mode === "body" ? "kitchen" : "body"])} style={[styles.tab, rail ? styles.railTab : styles.switch]}>
          <View style={[styles.capsule, { backgroundColor: colors.muted }]}>
            {(["kitchen", "body"] as const).map((one) => {
              const Icon = MODE_ICONS[one];
              const on = one === mode;
              return <View key={one} style={[styles.segment, on && { backgroundColor: colors.foreground }]}><Icon size={16} color={on ? colors.background : colors.mutedForeground} /></View>;
            })}
          </View>
        </Press>
        <View style={[rail ? styles.railDivider : styles.divider, { backgroundColor: colors.border }]} />
      </> : null}
      {TABS.filter((page) => page.mode === mode).map((page) => {
        const active = page.route === current.route;
        const ink = colors.pageInk[page.key];
        return (
          <Press key={page.key} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={text.tabs[page.key][0]}
            onPress={() => go(page.route)} style={[styles.tab, rail && styles.railTab]}>
            <View style={styles.icon}>
              {active ? <View style={[StyleSheet.absoluteFill, styles.highlight, { backgroundColor: tint(ink, 18, colors.background) }]} /> : null}
              <page.icon size={19} color={ink} />
            </View>
            <T weight="medium" muted={!active} maxFontSizeMultiplier={1.25} style={{ fontSize: 12, textAlign: "center" }}>{text.tabs[page.key][1]}</T>
          </Press>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", flexGrow: 1, borderTopWidth: StyleSheet.hairlineWidth },
  rail: { flexDirection: "column", borderTopWidth: 0, paddingTop: 12, gap: 8 },
  railTab: { flex: 0, minHeight: 72, paddingVertical: 8, paddingHorizontal: 4 },
  tab: { flex: 1, minHeight: 64, paddingVertical: 6, alignItems: "center", justifyContent: "center", gap: 4 },
  switch: { flex: 0, width: 76, paddingHorizontal: 6 },
  capsule: { flexDirection: "row", borderRadius: 18, padding: 3, gap: 2 },
  segment: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  divider: { width: StyleSheet.hairlineWidth, marginVertical: 14 },
  railDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },
  icon: { height: 28, width: 48, alignItems: "center", justifyContent: "center" },
  highlight: { borderRadius: 14 },
});
