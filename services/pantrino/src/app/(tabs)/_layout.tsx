import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Press, T, TABS, useKitText } from "../../ui/kit";
import { ModeProvider, useModeBar } from "../../ui/mode";
import { tint, useColors } from "../../ui/theme";
import { ContentLayoutContext, useContentLayout, useWindowLayout } from "../../ui/responsive";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

/** Kitchen and Body share one tab navigator, so each tab keeps its place while the other mode is open. */
export default function KitchenTabs() {
  const colors = useColors();
  const layout = useWindowLayout(true);
  return (
    <ContentLayoutContext value={layout}>
      <ModeProvider>
        <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.background }}>
          <Tabs screenOptions={{ headerShown: false, tabBarPosition: layout.navigation === "rail" ? "left" : "bottom", sceneStyle: { backgroundColor: colors.background } }} tabBar={(props) => <TabBar {...props} />}>
            {TABS.map((one) => <Tabs.Screen key={one.key} name={one.route} />)}
          </Tabs>
        </SafeAreaView>
      </ModeProvider>
    </ContentLayoutContext>
  );
}

/** The tabs of the open mode. The pill in each page header switches mode. */
function TabBar({ state, navigateToTab }: TabBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const text = useKitText();
  const layout = useContentLayout();
  const rail = layout.navigation === "rail";
  const current = TABS.find((one) => one.route === state.routes[state.index]?.name) ?? TABS[0];
  const go = (name: string) => { const route = state.routes.find((one) => one.name === name); if (route) navigateToTab(route.key); };
  useModeBar(current.route, go);

  return (
    <ScrollView horizontal={!rail} scrollEnabled={rail} scrollsToTop={false} showsVerticalScrollIndicator={false}
      style={rail ? { width: layout.railWidth, flexGrow: 0, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border } : { flexGrow: 0 }}
      contentContainerStyle={[styles.bar, rail && styles.rail, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: insets.bottom }]}>
      {TABS.filter((page) => page.mode === current.mode).map((page) => {
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
  icon: { height: 28, width: 48, alignItems: "center", justifyContent: "center" },
  highlight: { borderRadius: 14 },
});
