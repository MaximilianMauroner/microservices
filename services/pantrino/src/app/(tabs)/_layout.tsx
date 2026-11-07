import { Tabs, useSegments } from "expo-router";
import type { ComponentProps } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useSyncAlert } from "../../ui/kitchen/page";
import { PAGES, Press, T, useKitText } from "../../ui/kit";
import { tint, useColors } from "../../ui/theme";
import { ContentLayoutContext, useContentLayout, useWindowLayout } from "../../ui/responsive";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

export default function KitchenTabs() {
  const colors = useColors();
  const segments = useSegments();
  const layout = useWindowLayout(segments.length <= 2);
  return (
    <ContentLayoutContext value={layout}>
      <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.background }}>
        <Tabs screenOptions={{ headerShown: false, tabBarPosition: layout.navigation === "rail" ? "left" : "bottom", sceneStyle: { backgroundColor: colors.background } }} tabBar={(props) => <TabBar {...props} />}>
          {PAGES.map((one) => <Tabs.Screen key={one.key} name={one.route} />)}
        </Tabs>
      </SafeAreaView>
    </ContentLayoutContext>
  );
}

function TabBar({ state, navigateToTab }: TabBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const text = useKitText();
  const alert = useSyncAlert();
  const segments = useSegments();
  const layout = useContentLayout();
  const rail = layout.navigation === "rail";
  const current = state.routes[state.index];
  if (segments.length > 2) return null;
  return (
    <ScrollView horizontal={!rail} scrollEnabled={rail} scrollsToTop={false} showsVerticalScrollIndicator={false}
      style={rail ? { width: layout.railWidth, flexGrow: 0, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border } : { flexGrow: 0 }}
      contentContainerStyle={[styles.bar, rail && styles.rail, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: insets.bottom }]}>
      {PAGES.map((page) => {
        const active = page.route === current?.name;
        const ink = colors.pageInk[page.key];
        const marked = page.key === "kitchen" ? alert : null;
        return (
          <Press
            key={page.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={marked ? `${text.tabs[page.key][0]}, ${marked.label}` : text.tabs[page.key][0]}
            onPress={() => { const route = state.routes.find((one) => one.name === page.route); if (route) navigateToTab(route.key); }}
            style={[styles.tab, rail && styles.railTab]}
          >
            <View style={styles.icon}>
              {/* Android drops the corner radius when a mounted view changes its background, so the highlight mounts with its tab. */}
              {active ? <View style={[StyleSheet.absoluteFill, styles.highlight, { backgroundColor: tint(ink, 18, colors.background) }]} /> : null}
              <page.icon size={19} color={ink} />
              {marked ? <View style={[styles.dot, { backgroundColor: marked.warn ? colors.destructive : colors.mutedForeground, borderColor: colors.background }]} /> : null}
            </View>
            <T weight="medium" muted={!active} style={{ fontSize: rail ? 12 : 11, textAlign: "center" }}>{text.tabs[page.key][1]}</T>
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
  dot: { position: "absolute", top: 2, right: 10, width: 10, height: 10, borderRadius: 5, borderWidth: 2 }
});
