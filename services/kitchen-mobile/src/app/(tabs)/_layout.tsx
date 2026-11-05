import { Tabs, useSegments } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { PAGES, PageContext, T, useKitText } from "../../ui/kit";
import { type PageKey, tint, useColors } from "../../ui/theme";
import { TopBar } from "../../ui/top-bar";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const ROUTES: Record<PageKey, string> = { week: "index", shopping: "shopping", recipes: "recipes", home: "home", ingredients: "ingredients" };

export default function KitchenTabs() {
  const colors = useColors();
  const segments = useSegments() as string[];
  const page = PAGES.find((one) => segments.includes(ROUTES[one.key]))?.key ?? "week";
  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: colors.background }}>
      <PageContext.Provider value={page}>
        <TopBar />
      </PageContext.Provider>
      <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }} tabBar={(props) => <TabBar {...props} />}>
        {PAGES.map((one) => <Tabs.Screen key={one.key} name={ROUTES[one.key]} />)}
      </Tabs>
    </SafeAreaView>
  );
}

/** The bottom tabs of the web Kitchen on a phone: five pages, each in its produce color. */
function TabBar({ state, navigateToTab }: TabBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const text = useKitText();
  const current = state.routes[state.index]?.name;
  return (
    <View style={[styles.bar, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: insets.bottom }]}>
      {PAGES.map((page) => {
        const active = ROUTES[page.key] === current;
        const ink = colors.pageInk[page.key];
        return (
          <Pressable
            key={page.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={text.tabs[page.key][0]}
            onPress={() => { const route = state.routes.find((one) => one.name === ROUTES[page.key]); if (route) navigateToTab(route.key); }}
            style={styles.tab}
          >
            <View style={[styles.icon, active && { backgroundColor: tint(ink, 18, colors.background) }]}>
              <page.icon size={19} color={ink} />
            </View>
            <T weight="medium" muted={!active} style={{ fontSize: 11 }}>{text.tabs[page.key][1]}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, height: 64, alignItems: "center", justifyContent: "center", gap: 4 },
  icon: { height: 28, width: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" }
});
